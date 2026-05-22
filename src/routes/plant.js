import { Router } from "express";
import crypto from "node:crypto";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { getStarterStrain } from "../game/strains.js";
import { computeCurrentPhase, getPhaseDuration, isMatureForHarvest } from "../game/growth.js";
import { signPayload } from "../utils/hmac.js";

const router = Router();

/**
 * POST /api/plant/sow
 * Body : { nonce, slotId, seedType }
 *
 * Crée une plante côté serveur. Le planted_at_ms est dicté par le backend,
 * jamais par le client → impossible de speed-grow en mentant sur le timestamp.
 */
router.post( "/sow", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, slotId, seedType } = req.body ?? {};

	try {
		const strain = getStarterStrain( seedType );
		if ( !strain ) {
			return res.status( 400 ).json( { error: `Unknown seedType: ${seedType}` } );
		}

		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			// TODO : décrémenter l'inventaire de graines quand on aura un shop.
			// Pour M0 : on autorise un nombre illimité de sows.

			const id = crypto.randomUUID();
			const nowMs = Date.now();

			db.prepare( `
				INSERT INTO plants (
					id, owner, genome_json, phase,
					planted_at_ms, phase_started_at_ms,
					flowering_triggered, quality_multiplier
				)
				VALUES ( ?, ?, ?, 'germination', ?, ?, 0, 1.0 )
			` ).run( id, steamid, JSON.stringify( strain ), nowMs, nowMs );

			return { id, plantedAtMs: nowMs };
		} );

		res.json( {
			ok: true,
			plantId: result.id,
			plantedAtMs: result.plantedAtMs,
			genome: strain,
			signature: signPayload( `sow:${result.id}:${result.plantedAtMs}` )
		} );
	}
	catch ( err ) {
		res.status( 400 ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * POST /api/plant/trigger-flowering
 * Body : { nonce, plantId }
 *
 * Switch 18/6 → 12/12. Ignoré pour autoflowers.
 */
router.post( "/trigger-flowering", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, plantId } = req.body ?? {};

	try {
		runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const plant = db.prepare(
				"SELECT * FROM plants WHERE id = ? AND owner = ?"
			).get( plantId, steamid );

			if ( !plant ) {
				const e = new Error( "Plant not found" );
				e.code = "NO_PLANT";
				throw e;
			}

			const genome = JSON.parse( plant.genome_json );
			if ( genome.isAutoflower ) {
				const e = new Error( "Autoflowers cannot be manually triggered" );
				e.code = "AUTOFLOWER";
				throw e;
			}

			// Recalcule la phase courante : doit être vegetative
			const computed = computeCurrentPhase( plant, Date.now() );
			if ( computed.phase !== "vegetative" ) {
				const e = new Error( `Plant must be vegetative, currently ${computed.phase}` );
				e.code = "WRONG_PHASE";
				throw e;
			}

			db.prepare( `
				UPDATE plants
				SET phase = 'flowering',
				    phase_started_at_ms = ?,
				    flowering_triggered = 1,
				    updated_at = strftime('%s','now')
				WHERE id = ?
			` ).run( Date.now(), plantId );
		} );

		res.json( { ok: true } );
	}
	catch ( err ) {
		res.status( 400 ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * POST /api/plant/harvest
 * Body : { nonce, plantId }
 *
 * Vérifie que la plante a effectivement complété la floraison (server-clock).
 * Calcule le yield server-side depuis genome → impossible d'inflater.
 * Renvoie un résultat signé HMAC.
 */
router.post( "/harvest", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, plantId } = req.body ?? {};

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const plant = db.prepare(
				"SELECT * FROM plants WHERE id = ? AND owner = ?"
			).get( plantId, steamid );

			if ( !plant ) {
				const e = new Error( "Plant not found" );
				e.code = "NO_PLANT";
				throw e;
			}

			const nowMs = Date.now();
			const computed = computeCurrentPhase( plant, nowMs );

			if ( computed.phase !== "flowering" || computed.progress < 1 ) {
				if ( !isMatureForHarvest( plant, nowMs ) ) {
					const e = new Error( `Plant not mature for harvest (phase=${computed.phase}, progress=${computed.progress.toFixed(2)})` );
					e.code = "NOT_MATURE";
					throw e;
				}
			}

			const genome = JSON.parse( plant.genome_json );

			// Yield server-side. M0 = formule simple, M2+ = stress, environnement, trichome timing.
			const yieldGrams = genome.yieldGramsBase * ( plant.quality_multiplier ?? 1 );

			db.prepare( `
				UPDATE plants
				SET phase = 'harvested',
				    phase_started_at_ms = ?,
				    harvested_grams = ?,
				    updated_at = strftime('%s','now')
				WHERE id = ?
			` ).run( nowMs, yieldGrams, plantId );

			return { yieldGrams, harvestedAtMs: nowMs };
		} );

		const payload = `harvest:${plantId}:${result.yieldGrams.toFixed(2)}:${result.harvestedAtMs}`;
		res.json( {
			ok: true,
			plantId,
			yieldGrams: result.yieldGrams,
			harvestedAtMs: result.harvestedAtMs,
			signature: signPayload( payload )
		} );
	}
	catch ( err ) {
		res.status( 400 ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
