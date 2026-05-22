import { Router } from "express";
import { verifySteamTicket } from "../auth/steam.js";
import { issueToken } from "../auth/jwt.js";
import { db } from "../db/index.js";

const router = Router();

/**
 * POST /auth/steam
 * Body : { ticket: string, claimedSteamId?: string }
 *   - ticket           : Steam auth ticket récupéré côté client (Sandbox API)
 *   - claimedSteamId   : utilisé uniquement en mode bypass (dev)
 *
 * Renvoie : { token, expiresIn, steamid }
 */
router.post( "/steam", async ( req, res ) => {
	try {
		const { ticket, claimedSteamId } = req.body ?? {};

		const { steamid, bypassed } = await verifySteamTicket( { ticket, claimedSteamId } );

		// Crée le joueur s'il n'existe pas, idempotent
		db.prepare( `
			INSERT INTO players ( steamid, cash )
			VALUES ( ?, 1000 )
			ON CONFLICT( steamid ) DO NOTHING
		` ).run( steamid );

		const token = issueToken( steamid );

		res.json( {
			token,
			steamid,
			expiresIn: 3600,
			bypassed
		} );
	}
	catch ( err ) {
		console.error( "[/auth/steam]", err.message );
		res.status( 401 ).json( { error: err.message } );
	}
} );

export default router;
