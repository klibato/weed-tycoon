import { Router } from "express";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { signPayload } from "../utils/hmac.js";

const router = Router();

const MAX_STATE_JSON_BYTES = 64 * 1024; // 64KB cap raisonnable pour le blob client

/**
 * POST /api/player/load
 * Auth required.
 *
 * Renvoie l'état persisté côté serveur. Si premier login, state_json est null.
 * Le client reconcilie : si son nonce local > backend → re-push son état après le merge.
 */
router.post( "/load", ( req, res ) => {
	const steamid = req.steamid;

	const player = db.prepare( "SELECT * FROM players WHERE steamid = ?" ).get( steamid );
	if ( !player ) return res.status( 404 ).json( { error: "Player not found" } );

	let state = null;
	try { state = player.state_json ? JSON.parse( player.state_json ) : null; }
	catch ( _ ) { state = null; }

	res.json( {
		ok: true,
		steamid,
		lastNonce: player.last_nonce,
		stateUpdatedAtMs: player.state_updated_at ?? 0,
		state,
		serverNowMs: Date.now()
	} );
} );

/**
 * POST /api/player/save
 * Body : { nonce, state, displayName? }
 *
 * Push le state complet (cash, tiers, équipements, inventaires, placedPots, stats).
 * Nonce monotone par steamid. Le payload state est opaque côté backend (validé sommairement
 * mais pas de schema strict — flexibilité pour évoluer côté client sans migration backend).
 *
 * Limites :
 *   - state JSON taille < 64KB
 *   - nonce strictement croissant (replay rejeté)
 *
 * À terme on pourra extraire les champs queryables (cash, room_tier) en colonnes dédiées
 * pour exposer des leaderboards "richesse" / "build progress".
 */
router.post( "/save", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, state, displayName } = req.body ?? {};

	if ( state === undefined || state === null ) {
		return res.status( 400 ).json( { error: "state required", code: "NO_STATE" } );
	}

	// Validation taille
	let stateJson;
	try { stateJson = JSON.stringify( state ); }
	catch ( _ ) { return res.status( 400 ).json( { error: "state not serializable", code: "BAD_STATE" } ); }
	if ( stateJson.length > MAX_STATE_JSON_BYTES ) {
		return res.status( 413 ).json( { error: `state too large (${stateJson.length}B, max ${MAX_STATE_JSON_BYTES}B)`, code: "STATE_TOO_LARGE" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const nowMs = Date.now();
			db.prepare( `
				UPDATE players
				SET state_json = ?,
				    state_updated_at = ?,
				    display_name = COALESCE(?, display_name),
				    updated_at = strftime('%s','now')
				WHERE steamid = ?
			` ).run(
				stateJson,
				nowMs,
				typeof displayName === "string" ? displayName.slice( 0, 64 ) : null,
				steamid
			);

			return { nowMs };
		} );

		const sig = signPayload( `save:${steamid}:${nonce}:${result.nowMs}` );
		res.json( { ok: true, stateUpdatedAtMs: result.nowMs, signature: sig } );
	}
	catch ( err ) {
		const status = err.code === "REPLAY" ? 409 : 400;
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
