import { Router } from "express";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { computeCurrentPhase } from "../game/growth.js";

const router = Router();

/**
 * POST /api/player/load
 * Auth required (req.steamid).
 *
 * Renvoie l'état complet du joueur :
 *   - cash, last_nonce
 *   - plantes en cours (avec phase recalculée server-clock)
 *   - inventaire
 */
router.post( "/load", ( req, res ) => {
	const steamid = req.steamid;

	const player = db.prepare( "SELECT * FROM players WHERE steamid = ?" ).get( steamid );
	if ( !player ) return res.status( 404 ).json( { error: "Player not found" } );

	const plants = db.prepare( `
		SELECT id, owner, genome_json, phase, planted_at_ms, phase_started_at_ms,
		       flowering_triggered, harvested_grams, quality_multiplier
		FROM plants WHERE owner = ?
	` ).all( steamid );

	const now = Date.now();
	const plantsWithLivePhase = plants.map( p => {
		const computed = computeCurrentPhase( p, now );
		return {
			id: p.id,
			genome: JSON.parse( p.genome_json ),
			storedPhase: p.phase,
			currentPhase: computed.phase,
			currentProgress: computed.progress,
			plantedAtMs: p.planted_at_ms,
			phaseStartedAtMs: computed.phaseStartedAtMs,
			floweringTriggered: !!p.flowering_triggered,
			harvestedGrams: p.harvested_grams,
			qualityMultiplier: p.quality_multiplier
		};
	} );

	const inventory = db.prepare(
		"SELECT item_type, quantity FROM player_inventory WHERE steamid = ?"
	).all( steamid );

	res.json( {
		steamid,
		cash: player.cash,
		lastNonce: player.last_nonce,
		plants: plantsWithLivePhase,
		inventory,
		serverNowMs: now
	} );
} );

/**
 * POST /api/player/save
 * Body : { nonce, displayName? }
 *
 * Pour le M0, le "save" se limite à des metadata cosmétiques. L'état de jeu
 * (plantes, cash) est piloté par les routes /api/plant/* et autres, jamais
 * par un blob de save côté client.
 */
router.post( "/save", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, displayName } = req.body ?? {};

	try {
		runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			if ( displayName !== undefined ) {
				db.prepare(
					"UPDATE players SET display_name = ?, updated_at = strftime('%s','now') WHERE steamid = ?"
				).run( String( displayName ).slice( 0, 64 ), steamid );
			}
		} );

		res.json( { ok: true } );
	}
	catch ( err ) {
		res.status( 400 ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
