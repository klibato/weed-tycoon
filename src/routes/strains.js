import { Router } from "express";
import { db, runInTransaction } from "../db/index.js";
import { checkAndBumpNonce } from "../utils/nonce.js";
import { signPayload } from "../utils/hmac.js";

const router = Router();

const NAME_MIN = 2;
const NAME_MAX = 64;
const NAME_REGEX = /^[\p{L}\p{N}_\-·×#&'\.\s]+$/u;

const LEADERBOARD_DEFAULT_LIMIT = 50;
const LEADERBOARD_MAX_LIMIT = 200;

function sanitizeName( raw ) {
	if ( typeof raw !== "string" ) return null;
	const trimmed = raw.trim();
	if ( trimmed.length < NAME_MIN || trimmed.length > NAME_MAX ) return null;
	if ( !NAME_REGEX.test( trimmed ) ) return null;
	return trimmed;
}

function rowToStrain( row ) {
	if ( !row ) return null;
	return {
		hash: row.hash,
		name: row.name,
		firstDiscoverer: row.first_discoverer,
		discovererName: row.discoverer_name ?? null,
		genome: JSON.parse( row.genome_json ),
		bagAppeal: row.bag_appeal,
		generation: row.generation,
		registeredAt: row.registered_at,
	};
}

/**
 * POST /api/strains/register
 * Body : { nonce, hash, name, genome, bagAppeal, generation }
 *
 * Premier discoverer du hash gagne le naming à perpétuité.
 * - Hash déjà connu → retourne l'existing strain avec isNew=false (idempotent)
 * - Hash nouveau + nom libre → insert + isNew=true
 * - Hash nouveau + nom déjà pris → 409 NAME_TAKEN (le client peut retry avec un autre nom)
 */
router.post( "/register", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, hash, name, genome, bagAppeal, generation } = req.body ?? {};

	if ( typeof hash !== "string" || hash.length < 4 || hash.length > 128 ) {
		return res.status( 400 ).json( { error: "Invalid hash", code: "BAD_HASH" } );
	}
	const cleanName = sanitizeName( name );
	if ( !cleanName ) {
		return res.status( 400 ).json( {
			error: `Invalid name (must be ${NAME_MIN}-${NAME_MAX} chars, letters/digits/_-·×#&'.\\s only)`,
			code: "BAD_NAME"
		} );
	}
	if ( !genome || typeof genome !== "object" ) {
		return res.status( 400 ).json( { error: "Invalid genome", code: "BAD_GENOME" } );
	}
	if ( typeof bagAppeal !== "number" || !Number.isFinite( bagAppeal ) ) {
		return res.status( 400 ).json( { error: "Invalid bagAppeal", code: "BAD_APPEAL" } );
	}
	if ( !Number.isInteger( generation ) || generation < 0 || generation > 32 ) {
		return res.status( 400 ).json( { error: "Invalid generation", code: "BAD_GEN" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			// Hash déjà connu → idempotent, retourne l'existing.
			const existing = db.prepare(
				"SELECT * FROM strains WHERE hash = ?"
			).get( hash );
			if ( existing ) {
				return { strain: rowToStrain( existing ), isNew: false };
			}

			// Nom déjà pris par un autre hash ?
			const nameClash = db.prepare(
				"SELECT hash FROM strains WHERE name = ?"
			).get( cleanName );
			if ( nameClash ) {
				const e = new Error( `Strain name "${cleanName}" already taken` );
				e.code = "NAME_TAKEN";
				throw e;
			}

			db.prepare( `
				INSERT INTO strains ( hash, name, first_discoverer, genome_json, bag_appeal, generation )
				VALUES ( ?, ?, ?, ?, ?, ? )
			` ).run( hash, cleanName, steamid, JSON.stringify( genome ), bagAppeal, generation );

			const inserted = db.prepare(
				"SELECT * FROM strains WHERE hash = ?"
			).get( hash );
			return { strain: rowToStrain( inserted ), isNew: true };
		} );

		const sig = signPayload( `strain:${result.strain.hash}:${result.strain.firstDiscoverer}:${result.strain.registeredAt}` );
		res.json( { ok: true, isNew: result.isNew, strain: result.strain, signature: sig } );
	}
	catch ( err ) {
		const status = err.code === "NAME_TAKEN" ? 409 : 400;
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

/**
 * GET /api/strains/leaderboard
 * Query : limit (default 50, max 200), offset (default 0)
 *
 * Top par bag_appeal DESC. Mode lecture, pas de nonce, mais auth + rate-limit.
 */
router.get( "/leaderboard", ( req, res ) => {
	let limit = parseInt( req.query.limit, 10 );
	let offset = parseInt( req.query.offset, 10 );
	if ( !Number.isFinite( limit ) || limit <= 0 ) limit = LEADERBOARD_DEFAULT_LIMIT;
	if ( limit > LEADERBOARD_MAX_LIMIT ) limit = LEADERBOARD_MAX_LIMIT;
	if ( !Number.isFinite( offset ) || offset < 0 ) offset = 0;

	const rows = db.prepare( `
		SELECT s.*, p.display_name AS discoverer_name
		FROM strains s
		LEFT JOIN players p ON p.steamid = s.first_discoverer
		ORDER BY s.bag_appeal DESC, s.registered_at ASC
		LIMIT ? OFFSET ?
	` ).all( limit, offset );

	const total = db.prepare( "SELECT COUNT(*) AS n FROM strains" ).get().n;

	res.json( {
		ok: true,
		total,
		limit,
		offset,
		strains: rows.map( rowToStrain )
	} );
} );

/**
 * GET /api/strains/by-hash/:hash
 * Retourne une souche par hash. 404 si inconnue.
 */
router.get( "/by-hash/:hash", ( req, res ) => {
	const hash = req.params.hash;
	if ( typeof hash !== "string" || hash.length < 4 || hash.length > 128 ) {
		return res.status( 400 ).json( { error: "Invalid hash", code: "BAD_HASH" } );
	}

	const row = db.prepare( `
		SELECT s.*, p.display_name AS discoverer_name
		FROM strains s
		LEFT JOIN players p ON p.steamid = s.first_discoverer
		WHERE s.hash = ?
	` ).get( hash );

	if ( !row ) return res.status( 404 ).json( { error: "Strain not found", code: "NO_STRAIN" } );
	res.json( { ok: true, strain: rowToStrain( row ) } );
} );

/**
 * GET /api/strains/by-discoverer/:steamid
 * Liste les souches découvertes par un joueur (utile pour l'UI "my strains").
 */
router.get( "/by-discoverer/:steamid", ( req, res ) => {
	const steamid = req.params.steamid;
	if ( typeof steamid !== "string" || steamid.length < 4 || steamid.length > 64 ) {
		return res.status( 400 ).json( { error: "Invalid steamid", code: "BAD_STEAMID" } );
	}

	const rows = db.prepare( `
		SELECT s.*, p.display_name AS discoverer_name
		FROM strains s
		LEFT JOIN players p ON p.steamid = s.first_discoverer
		WHERE s.first_discoverer = ?
		ORDER BY s.registered_at DESC
	` ).all( steamid );

	res.json( { ok: true, total: rows.length, strains: rows.map( rowToStrain ) } );
} );

export default router;
