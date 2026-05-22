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
 * POST /api/breed
 * Body : { nonce, parent1Hash, parent2Hash, customName? }
 *
 * Server-authoritative breeding :
 *   - RNG seedé par hash(steamid + parents + nonce + serverSecret) — anti-cheat
 *   - Toutes les stats enfant calculées côté serveur (impossible d'inflater)
 *   - Auto-register dans strains DB si le bucket (lineage+mutation+species+auto) est nouveau
 *   - Retourne le genome + isNew + improved + signature HMAC
 */
router.post( "/", ( req, res ) => {
	const steamid = req.steamid;
	const { nonce, parent1Hash, parent2Hash, customName } = req.body ?? {};

	if ( typeof parent1Hash !== "string" || typeof parent2Hash !== "string" ) {
		return res.status( 400 ).json( { error: "parent1Hash and parent2Hash required", code: "BAD_PARENTS" } );
	}

	try {
		const result = runInTransaction( () => {
			checkAndBumpNonce( db, steamid, nonce );

			const p1 = loadParentGenome( parent1Hash );
			const p2 = loadParentGenome( parent2Hash );
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
			db.prepare( `
				UPDATE players SET updated_at = strftime('%s','now') WHERE steamid = ?
			` ).run( steamid );

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
		res.status( status ).json( { error: err.message, code: err.code } );
	}
} );

export default router;
