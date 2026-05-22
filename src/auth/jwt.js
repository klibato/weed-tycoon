import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Issue un JWT pour une SteamID donnée. Le token contient :
 *   - sub  : steamid (string)
 *   - iat  : issued at
 *   - exp  : expires at
 *   - jti  : token id unique (pour révocation si besoin un jour)
 */
export function issueToken( steamid ) {
	const jti = crypto.randomBytes( 16 ).toString( "hex" );
	return jwt.sign(
		{ sub: String( steamid ), jti },
		config.auth.jwtSecret,
		{
			algorithm: "HS256",
			expiresIn: config.auth.jwtExpiresIn
		}
	);
}

/**
 * Vérifie + décode un JWT. Throw si invalide/expiré.
 * Renvoie { steamid, jti, iat, exp }.
 */
export function verifyToken( token ) {
	const decoded = jwt.verify( token, config.auth.jwtSecret, {
		algorithms: [ "HS256" ]
	} );
	return {
		steamid: decoded.sub,
		jti: decoded.jti,
		iat: decoded.iat,
		exp: decoded.exp
	};
}
