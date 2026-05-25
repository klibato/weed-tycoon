import { Router } from "express";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { signPayload } from "../utils/hmac.js";
import { getStarterStrain } from "../game/strains.js";
import { cross } from "../game/breeding.js";
import { config } from "../config.js";

const router = Router();

/**
 * Récupère le genome d'un parent depuis son hash. Source de vérité :
 *   - "starter_*" → STARTER_STRAINS (en mémoire, mirror du C#)
 *   - "bred_*"    → strains DB (souches communautaires registered)
 *
 * Note : on retourne le genome dans le shape attendu par cross().
 */
function loadParentGenome( hash ) {
	if ( typeof hash !== "string" ) return null;

	if ( hash.startsWith( "starter_" ) ) {
		const s = getStarterStrain( hash );
		if ( !s ) return null;
		return {
			...s,
			lineage: s.strainName,
			mutationType: null,
		};
	}

	if ( hash.startsWith( "bred_" ) ) {
		const row = db.prepare( "SELECT * FROM strains WHERE hash = ?" ).get( hash );
		if ( !row ) return null;
		const genome = JSON.parse( row.genome_json );
		// Garantit la présence des champs lineage/mutationType pour cross().
		return {
			...genome,
			genomeHash: hash,
			strainName: row.name,
			lineage: genome.lineage ?? row.name,
			mutationType: genome.mutationType ?? null,
		};
	}

	return null;
}

/**
 * Sanitize un genome envoyé par le client (parent fallback). Anti-cheat : on ne fait pas confiance
 * aux stats — on clamp tout dans des bornes raisonnables et on force le shape exact attendu par cross().
 * Utilisé uniquement quand un bred_* est unknown DB (cas legacy : strain créé en fallback local côté client).
 */
function sanitizeClientGenome( g, hashHint ) {
	if ( !g || typeof g !== "object" ) return null;
	const clampNum = ( v, min, max, fallback ) => {
		const n = Number( v );
		return Number.isFinite( n ) ? Math.min( max, Math.max( min, n ) ) : fallback;
	};
	const color = ( c ) => ( c && typeof c === "object" )
		? { r: clampNum( c.r, 0, 1, 0.4 ), g: clampNum( c.g, 0, 1, 0.6 ), b: clampNum( c.b, 0, 1, 0.3 ) }
		: { r: 0.4, g: 0.6, b: 0.3 };
	const species = [ "Indica", "Sativa", "Ruderalis", "Hybrid" ].includes( g.species ) ? g.species : "Hybrid";
	return {
		genomeHash: typeof g.genomeHash === "string" ? g.genomeHash : hashHint,
		strainName: typeof g.strainName === "string" ? g.strainName.slice( 0, 80 ) : ( hashHint ?? "?" ),
		lineage: typeof g.lineage === "string" ? g.lineage.slice( 0, 160 ) : ( g.strainName ?? "?" ),
		mutationType: typeof g.mutationType === "string" ? g.mutationType.slice( 0, 32 ) : null,
		species,
		thcPercent:           clampNum( g.thcPercent,           1,   35,   18 ),
		cbdPercent:           clampNum( g.cbdPercent,           0,   25,   1 ),
		terpenePercent:       clampNum( g.terpenePercent,       0,   6,    1.5 ),
		yieldGramsBase:       clampNum( g.yieldGramsBase,       40,  1000, 110 ),
		flowerTimeMultiplier: clampNum( g.flowerTimeMultiplier, 0.7, 1.6,  1 ),
		heightCm:             clampNum( g.heightCm,             30,  360,  120 ),
		pestResistance:       clampNum( g.pestResistance,       0,   1,    0.5 ),
		moldResistance:       clampNum( g.moldResistance,       0,   1,    0.5 ),
		heatTolerance:        clampNum( g.heatTolerance,        0,   1,    0.5 ),
		leafColor:            color( g.leafColor ),
		isAutoflower:         !!g.isAutoflower,
		generation:           clampNum( g.generation,           0,   20,   1 ),
		isStabilizedIbl:      !!g.isStabilizedIbl,
	};
}

/**
 * POST /api/breed
 * Body : { nonce, parent1Hash, parent2Hash, parent1Genome?, parent2Genome?, customName?, displayName? }
 *
 * Server-authoritative breeding :
 *   - RNG seedé par hash(steamid + parents + nonce + serverSecret) — anti-cheat
 *   - Toutes les stats enfant calculées côté serveur (impossible d'inflater)
 *   - Auto-register dans strains DB si le bucket (lineage+mutation+species+auto) est nouveau
 *   - Upsert players.display_name si fourni (assure que le leaderboard a un nom dès la 1ʳᵉ breed,
 *     sans dépendre du throttle de /api/player/save)
 *   - Retourne le genome + isNew + improved + signature HMAC
 *
 * Cascade fix : si un parent bred_* est inconnu DB (cas legacy local-fallback côté client),
 * on accepte un parent1Genome/parent2Genome dans le body et on sanitize les stats avant de cross.
 * Anti-cheat : les stats sont clampées dans des bornes raisonnables.
 */
router.post( "/", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, parent1Hash, parent2Hash, parent1Genome, parent2Genome, customName, displayName } = req.body ?? {};

	if ( typeof parent1Hash !== "string" || typeof parent2Hash !== "string" ) {
		return res.status( 400 ).json( { error: "parent1Hash and parent2Hash required", code: "BAD_PARENTS" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			let p1 = loadParentGenome( parent1Hash );
			let p2 = loadParentGenome( parent2Hash );

			// Cascade fix : si parent bred_* inconnu DB mais le client fournit un genome fallback, on l'accepte sanitized.
			if ( !p1 && parent1Hash.startsWith( "bred_" ) && parent1Genome ) {
				p1 = sanitizeClientGenome( parent1Genome, parent1Hash );
				if ( p1 ) {
					db.prepare( `
						INSERT OR IGNORE INTO strains ( hash, name, first_discoverer, genome_json, bag_appeal, generation )
						VALUES ( ?, ?, ?, ?, ?, ? )
					` ).run( p1.genomeHash, p1.strainName, steamid, JSON.stringify( p1 ),
						p1.thcPercent * 2 + p1.yieldGramsBase * 0.1 + p1.terpenePercent * 5, p1.generation );
				}
			}
			if ( !p2 && parent2Hash.startsWith( "bred_" ) && parent2Genome ) {
				p2 = sanitizeClientGenome( parent2Genome, parent2Hash );
				if ( p2 ) {
					db.prepare( `
						INSERT OR IGNORE INTO strains ( hash, name, first_discoverer, genome_json, bag_appeal, generation )
						VALUES ( ?, ?, ?, ?, ?, ? )
					` ).run( p2.genomeHash, p2.strainName, steamid, JSON.stringify( p2 ),
						p2.thcPercent * 2 + p2.yieldGramsBase * 0.1 + p2.terpenePercent * 5, p2.generation );
				}
			}

			if ( !p1 ) {
				const e = new Error( `Unknown parent1: ${parent1Hash}` ); e.code = "NO_PARENT1"; throw e;
			}
			if ( !p2 ) {
				const e = new Error( `Unknown parent2: ${parent2Hash}` ); e.code = "NO_PARENT2"; throw e;
			}

			// Cross server-authoritative (RNG seedé).
			const out = cross( p1, p2, steamid, nonce, config.auth.hmacResponseSecret );
			const child = out.childGenome;

			// Nom custom (player-chosen) appliqué pour le strain register UNIQUEMENT si bucket nouveau.
			// Sinon le nom canonique du bucket existant prend le dessus.
			let strainName = child.strainName;
			let nameForRegister = null;
			if ( typeof customName === "string" && customName.trim().length >= 2 && customName.trim().length <= 64 ) {
				nameForRegister = customName.trim();
			}

			// Auto-register le bucket si nouveau (first discoverer wins le naming).
			const existing = db.prepare( "SELECT * FROM strains WHERE hash = ?" ).get( child.genomeHash );
			let isNew = false;
			let improved = false;

			if ( !existing ) {
				const finalName = nameForRegister ?? strainName;
				// Check name conflict — fallback hash suffix si déjà pris.
				let nameToUse = finalName;
				const clash = db.prepare( "SELECT 1 FROM strains WHERE name = ?" ).get( nameToUse );
				if ( clash ) {
					nameToUse = `${finalName} #${child.genomeHash.slice( -4 )}`;
				}
				db.prepare( `
					INSERT INTO strains ( hash, name, first_discoverer, genome_json, bag_appeal, generation )
					VALUES ( ?, ?, ?, ?, ?, ? )
				` ).run(
					child.genomeHash,
					nameToUse,
					steamid,
					JSON.stringify( child ),
					out.combinedScore,
					child.generation
				);
				strainName = nameToUse;
				isNew = true;
			} else {
				// Bucket existant : check best-of, update si l'enfant a un meilleur score.
				if ( out.combinedScore > existing.bag_appeal ) {
					db.prepare( `
						UPDATE strains
						SET genome_json = ?, bag_appeal = ?, generation = ?
						WHERE hash = ?
					` ).run(
						JSON.stringify( child ),
						out.combinedScore,
						Math.max( existing.generation, child.generation ),
						child.genomeHash
					);
					improved = true;
				}
				strainName = existing.name;
			}

			// Met à jour les stats joueur (host-auth).
			// COALESCE garde l'ancien display_name si le client n'en fournit pas — évite de l'écraser
			// avec null si breed appelé sans displayName.
			db.prepare( `
				UPDATE players
				SET display_name = COALESCE(?, display_name),
				    updated_at = strftime('%s','now')
				WHERE steamid = ?
			` ).run(
				typeof displayName === "string" && displayName.trim().length > 0
					? displayName.trim().slice( 0, 64 )
					: null,
				steamid
			);

			return {
				childGenome: { ...child, strainName },
				seedCount: out.seedCount,
				mutated: out.mutated,
				mutationLabel: out.mutationLabel,
				combinedScore: out.combinedScore,
				isNew,
				improved,
			};
		} );

		const sig = signPayload(
			`breed:${steamid}:${result.childGenome.genomeHash}:${result.seedCount}:${result.isNew ? 1 : 0}`
		);
		res.json( { ok: true, ...result, signature: sig } );
	}
	catch ( err ) {
		const status = err.code === "NO_PARENT1" || err.code === "NO_PARENT2" ? 404 : 400;
		console.error(
			`[breed ${status}] steamid=${steamid} code=${err.code} msg=${err.message} parents=${parent1Hash}|${parent2Hash} nonce=${nonce}`
		);
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
