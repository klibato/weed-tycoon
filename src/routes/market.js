import { Router } from "express";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { signPayload } from "../utils/hmac.js";
import { sanitizeClientGenome } from "./breed.js";

const router = Router();

// =============================================================================
// v0.6 SEED BANK — marketplace player-to-player de seeds.
//
// Modèle de confiance (cohérent avec le reste du backend) :
//   - Les seeds vendues sont ESCROWED dans la listing : le serveur vérifie la
//     possession contre le dernier state_json pushé (best-effort, ~10s stale max),
//     et le client déduit son inventaire local + re-push immédiatement après le list.
//   - Le cash de l'acheteur est débité côté client (TrySpend local, comme le
//     breeding cost) avec sanity check server-side contre son state_json.
//   - Le cash du vendeur/découvreur s'accumule SERVER-SIDE dans players.market_balance
//     et se réclame via /claim — on n'injecte jamais de cash dans un state blob.
//   - Royalty : ROYALTY_PCT du gross à perpétuité pour le first_discoverer de la
//     strain (si différent du vendeur). Son nom devient une marque.
// =============================================================================

const ROYALTY_PCT = 0.05;
const MIN_PRICE = 1;
const MAX_PRICE = 50000;
const MAX_QTY_PER_LISTING = 200;
const MAX_LISTINGS_PER_PLAYER = 12;
const BROWSE_LIMIT = 200;

const round2 = ( n ) => Math.round( n * 100 ) / 100;

/** Parse le state blob d'un joueur (PascalCase côté C#). Null si absent/corrompu. */
function loadPlayerState( steamid ) {
	const row = db.prepare( "SELECT state_json FROM players WHERE steamid = ?" ).get( steamid );
	if ( !row?.state_json ) return null;
	try { return JSON.parse( row.state_json ); }
	catch ( _ ) { return null; }
}

/** Résumé d'un genome pour le browse (le full genome n'est renvoyé qu'au buy). */
function genomeSummary( genomeJson ) {
	try {
		const g = JSON.parse( genomeJson );
		return {
			thcPercent: g.thcPercent ?? 0,
			yieldGramsBase: g.yieldGramsBase ?? 0,
			terpenePercent: g.terpenePercent ?? 0,
			generation: g.generation ?? 0,
			species: g.species ?? "Hybrid",
			isAutoflower: !!g.isAutoflower,
			isStabilizedIbl: !!g.isStabilizedIbl,
			mutationType: g.mutationType ?? null,
		};
	}
	catch ( _ ) { return null; }
}

/**
 * GET /api/market/listings
 * Browse global + infos perso (solde market, events non réclamés).
 */
router.get( "/listings", ( req, res ) => {
	const steamid = req.steamid;

	const rows = db.prepare( `
		SELECT l.id, l.seller, l.strain_hash, l.qty, l.price_per_seed, l.created_at,
		       p.display_name AS seller_name,
		       s.name AS strain_name, s.genome_json, s.first_discoverer,
		       d.display_name AS discoverer_name
		FROM market_listings l
		JOIN strains s ON s.hash = l.strain_hash
		LEFT JOIN players p ON p.steamid = l.seller
		LEFT JOIN players d ON d.steamid = s.first_discoverer
		ORDER BY l.created_at DESC
		LIMIT ?
	` ).all( BROWSE_LIMIT );

	const listings = rows.map( r => ( {
		id: r.id,
		strainHash: r.strain_hash,
		strainName: r.strain_name,
		qty: r.qty,
		pricePerSeed: r.price_per_seed,
		sellerSteamid: r.seller,
		sellerName: r.seller_name ?? "?",
		discovererName: r.discoverer_name ?? "?",
		isYours: r.seller === steamid,
		createdAt: r.created_at,
		genome: genomeSummary( r.genome_json ),
	} ) );

	const me = db.prepare( "SELECT market_balance FROM players WHERE steamid = ?" ).get( steamid );
	const events = db.prepare( `
		SELECT kind, strain_name, qty, amount, buyer_name, created_at
		FROM market_events WHERE steamid = ? AND claimed = 0
		ORDER BY created_at DESC LIMIT 50
	` ).all( steamid );

	res.json( {
		ok: true,
		listings,
		marketBalance: me?.market_balance ?? 0,
		unclaimedEvents: events.map( e => ( {
			kind: e.kind,
			strainName: e.strain_name,
			qty: e.qty,
			amount: e.amount,
			buyerName: e.buyer_name,
			createdAt: e.created_at,
		} ) ),
	} );
} );

/**
 * POST /api/market/list
 * Body : { nonce, strainHash, qty, pricePerSeed }
 *
 * Crée une listing (escrow). Seules les strains bred_* connues DB sont listables —
 * les starters s'achètent à l'infini au NPC shop, les trader serait du bruit.
 * Possession vérifiée contre le dernier state pushé. Le client DOIT déduire ses
 * seeds locales et re-push son state immédiatement après un list OK.
 */
router.post( "/list", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, strainHash, qty, pricePerSeed, genome } = req.body ?? {};

	const q = Math.floor( Number( qty ) );
	const price = round2( Number( pricePerSeed ) );

	if ( typeof strainHash !== "string" || !strainHash.startsWith( "bred_" ) ) {
		return res.status( 400 ).json( { error: "only bred strains can be listed", code: "BAD_STRAIN" } );
	}
	if ( !Number.isFinite( q ) || q < 1 || q > MAX_QTY_PER_LISTING ) {
		return res.status( 400 ).json( { error: `qty must be 1-${MAX_QTY_PER_LISTING}`, code: "BAD_QTY" } );
	}
	if ( !Number.isFinite( price ) || price < MIN_PRICE || price > MAX_PRICE ) {
		return res.status( 400 ).json( { error: `price must be $${MIN_PRICE}-$${MAX_PRICE}`, code: "BAD_PRICE" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			let strain = db.prepare( "SELECT hash, name FROM strains WHERE hash = ?" ).get( strainHash );

			// Cascade fix : strain bred en fallback local côté client → pas en DB. Si le client
			// fournit le génome, on l'enregistre (stats clampées anti-cheat) avec le vendeur comme
			// first_discoverer, puis on liste. Même pattern que /api/breed.
			if ( !strain && genome ) {
				const g = sanitizeClientGenome( genome, strainHash );
				if ( g ) {
					db.prepare( `
						INSERT OR IGNORE INTO strains ( hash, name, first_discoverer, genome_json, bag_appeal, generation )
						VALUES ( ?, ?, ?, ?, ?, ? )
					` ).run( g.genomeHash, g.strainName, steamid, JSON.stringify( g ),
						g.thcPercent * 2 + g.yieldGramsBase * 0.1 + g.terpenePercent * 5, g.generation );
					strain = db.prepare( "SELECT hash, name FROM strains WHERE hash = ?" ).get( strainHash );
				}
			}

			if ( !strain ) {
				const e = new Error( `Unknown strain: ${strainHash}` ); e.code = "NO_STRAIN"; throw e;
			}

			const count = db.prepare( "SELECT COUNT(*) AS n FROM market_listings WHERE seller = ?" ).get( steamid ).n;
			if ( count >= MAX_LISTINGS_PER_PLAYER ) {
				const e = new Error( `Max ${MAX_LISTINGS_PER_PLAYER} active listings` ); e.code = "TOO_MANY_LISTINGS"; throw e;
			}

			// Possession best-effort : le dernier state pushé doit montrer assez de seeds.
			// (state ~10s stale max ; le client re-push son inventaire décrémenté après le list)
			// ⚠ s&box sérialise le state en camelCase : seedInventory (pas SeedInventory).
			const state = loadPlayerState( steamid );
			const owned = state?.seedInventory?.[strainHash] ?? 0;
			if ( owned < q ) {
				const e = new Error( `Not enough seeds in synced state (${owned} < ${q})` ); e.code = "NOT_OWNED"; throw e;
			}

			const info = db.prepare( `
				INSERT INTO market_listings ( seller, strain_hash, qty, price_per_seed )
				VALUES ( ?, ?, ?, ? )
			` ).run( steamid, strainHash, q, price );

			db.prepare( `
				INSERT INTO action_log ( steamid, action, payload_json, ts_ms )
				VALUES ( ?, 'market_list', ?, ? )
			` ).run( steamid, JSON.stringify( { listingId: info.lastInsertRowid, strainHash, qty: q, price } ), Date.now() );

			return { listingId: info.lastInsertRowid, strainName: strain.name };
		} );

		const sig = signPayload( `list:${steamid}:${result.listingId}:${q}` );
		res.json( { ok: true, ...result, qty: q, pricePerSeed: price, signature: sig } );
	}
	catch ( err ) {
		const status = err.code === "REPLAY" ? 409 : err.code === "NO_STRAIN" ? 404 : 400;
		console.error( `[market/list ${status}] steamid=${steamid} code=${err.code} msg=${err.message}` );
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * POST /api/market/buy
 * Body : { nonce, listingId, qty, displayName? }
 *
 * Achète qty seeds d'une listing. Décrémente (ou supprime) la listing, crédite
 * le vendeur (gross - royalty) et le first_discoverer (royalty) dans market_balance.
 * Retourne le GENOME COMPLET : le client le registre en local (tag "Acquired")
 * pour pouvoir planter la strain. Le débit cash est fait côté client après OK
 * (sanity check ici contre son dernier state).
 */
router.post( "/buy", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, listingId, qty, displayName } = req.body ?? {};

	const q = Math.floor( Number( qty ) );
	if ( !Number.isFinite( q ) || q < 1 ) {
		return res.status( 400 ).json( { error: "bad qty", code: "BAD_QTY" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const l = db.prepare( `
				SELECT l.*, s.name AS strain_name, s.genome_json, s.first_discoverer,
				       p.display_name AS seller_name, d.display_name AS discoverer_name
				FROM market_listings l
				JOIN strains s ON s.hash = l.strain_hash
				LEFT JOIN players p ON p.steamid = l.seller
				LEFT JOIN players d ON d.steamid = s.first_discoverer
				WHERE l.id = ?
			` ).get( listingId );

			if ( !l ) { const e = new Error( "Listing not found" ); e.code = "NO_LISTING"; throw e; }
			if ( l.seller === steamid ) { const e = new Error( "Cannot buy your own listing" ); e.code = "SELF_BUY"; throw e; }
			if ( l.qty < q ) { const e = new Error( `Only ${l.qty} left` ); e.code = "NOT_ENOUGH_QTY"; throw e; }

			const gross = round2( l.price_per_seed * q );

			// Sanity check cash acheteur contre son dernier state pushé (anti-cheat parity).
			// ⚠ s&box sérialise le state en camelCase : cash (pas Cash).
			const buyerState = loadPlayerState( steamid );
			if ( buyerState && Number.isFinite( buyerState.cash ) && buyerState.cash < gross ) {
				const e = new Error( `Insufficient cash in synced state (${buyerState.cash} < ${gross})` ); e.code = "NO_CASH"; throw e;
			}

			// Décrémente / supprime la listing.
			if ( l.qty === q ) {
				db.prepare( "DELETE FROM market_listings WHERE id = ?" ).run( l.id );
			} else {
				db.prepare( "UPDATE market_listings SET qty = qty - ? WHERE id = ?" ).run( q, l.id );
			}

			// Répartition : royalty au découvreur (si ≠ vendeur), le reste au vendeur.
			const hasRoyalty = l.first_discoverer && l.first_discoverer !== l.seller;
			const royalty = hasRoyalty ? round2( gross * ROYALTY_PCT ) : 0;
			const sellerCut = round2( gross - royalty );

			const buyerName = typeof displayName === "string" && displayName.trim().length > 0
				? displayName.trim().slice( 0, 64 ) : null;

			db.prepare( "UPDATE players SET market_balance = market_balance + ? WHERE steamid = ?" )
				.run( sellerCut, l.seller );
			db.prepare( `
				INSERT INTO market_events ( steamid, kind, strain_name, qty, amount, buyer_name )
				VALUES ( ?, 'sale', ?, ?, ?, ? )
			` ).run( l.seller, l.strain_name, q, sellerCut, buyerName );

			if ( royalty > 0 ) {
				db.prepare( "UPDATE players SET market_balance = market_balance + ? WHERE steamid = ?" )
					.run( royalty, l.first_discoverer );
				db.prepare( `
					INSERT INTO market_events ( steamid, kind, strain_name, qty, amount, buyer_name )
					VALUES ( ?, 'royalty', ?, ?, ?, ? )
				` ).run( l.first_discoverer, l.strain_name, q, royalty, buyerName );
			}

			db.prepare( `
				INSERT INTO action_log ( steamid, action, payload_json, ts_ms )
				VALUES ( ?, 'market_buy', ?, ? )
			` ).run( steamid, JSON.stringify( { listingId: l.id, strainHash: l.strain_hash, qty: q, gross, royalty } ), Date.now() );

			let genome = null;
			try { genome = JSON.parse( l.genome_json ); } catch ( _ ) { genome = null; }

			return {
				strainHash: l.strain_hash,
				strainName: l.strain_name,
				qty: q,
				totalPrice: gross,
				genome,
				discovererName: l.discoverer_name ?? "?",
				sellerName: l.seller_name ?? "?",
			};
		} );

		const sig = signPayload( `marketbuy:${steamid}:${result.strainHash}:${result.qty}:${result.totalPrice}` );
		res.json( { ok: true, ...result, signature: sig } );
	}
	catch ( err ) {
		const status = err.code === "REPLAY" ? 409 : err.code === "NO_LISTING" ? 404 : 400;
		console.error( `[market/buy ${status}] steamid=${steamid} code=${err.code} msg=${err.message} listing=${listingId}` );
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * POST /api/market/cancel
 * Body : { nonce, listingId }
 * Supprime sa propre listing. Le client re-crédite les seeds localement.
 */
router.post( "/cancel", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, listingId } = req.body ?? {};

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const l = db.prepare( "SELECT * FROM market_listings WHERE id = ?" ).get( listingId );
			if ( !l ) { const e = new Error( "Listing not found" ); e.code = "NO_LISTING"; throw e; }
			if ( l.seller !== steamid ) { const e = new Error( "Not your listing" ); e.code = "NOT_YOURS"; throw e; }

			db.prepare( "DELETE FROM market_listings WHERE id = ?" ).run( l.id );
			db.prepare( `
				INSERT INTO action_log ( steamid, action, payload_json, ts_ms )
				VALUES ( ?, 'market_cancel', ?, ? )
			` ).run( steamid, JSON.stringify( { listingId: l.id, strainHash: l.strain_hash, qty: l.qty } ), Date.now() );

			return { strainHash: l.strain_hash, qty: l.qty };
		} );

		res.json( { ok: true, ...result } );
	}
	catch ( err ) {
		const status = err.code === "REPLAY" ? 409 : err.code === "NO_LISTING" ? 404 : 400;
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * POST /api/market/claim
 * Body : { nonce }
 * Réclame le solde market (ventes + royalties). Le serveur remet le solde à 0,
 * marque les events claimed, et retourne le montant — le client l'ajoute à son
 * cash local puis push son state. Mailbox pattern : pas d'injection dans le blob.
 */
router.post( "/claim", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce } = req.body ?? {};

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const me = db.prepare( "SELECT market_balance FROM players WHERE steamid = ?" ).get( steamid );
			const amount = round2( me?.market_balance ?? 0 );
			if ( amount <= 0 ) { const e = new Error( "Nothing to claim" ); e.code = "EMPTY"; throw e; }

			const events = db.prepare( `
				SELECT kind, strain_name, qty, amount, buyer_name FROM market_events
				WHERE steamid = ? AND claimed = 0 ORDER BY created_at DESC LIMIT 50
			` ).all( steamid );

			db.prepare( "UPDATE players SET market_balance = 0 WHERE steamid = ?" ).run( steamid );
			db.prepare( "UPDATE market_events SET claimed = 1 WHERE steamid = ? AND claimed = 0" ).run( steamid );

			db.prepare( `
				INSERT INTO action_log ( steamid, action, payload_json, ts_ms )
				VALUES ( ?, 'market_claim', ?, ? )
			` ).run( steamid, JSON.stringify( { amount } ), Date.now() );

			return { amount, events };
		} );

		const sig = signPayload( `marketclaim:${steamid}:${result.amount}` );
		res.json( {
			ok: true,
			amount: result.amount,
			events: result.events.map( e => ( {
				kind: e.kind, strainName: e.strain_name, qty: e.qty, amount: e.amount, buyerName: e.buyer_name,
			} ) ),
			signature: sig,
		} );
	}
	catch ( err ) {
		const status = err.code === "REPLAY" ? 409 : 400;
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
