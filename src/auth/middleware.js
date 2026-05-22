import { verifyToken } from "./jwt.js";

/**
 * Middleware Express : exige un JWT valide dans Authorization: Bearer <token>.
 * En cas de succès, attache req.steamid (string).
 */
export function requireAuth( req, res, next ) {
	const header = req.headers.authorization;
	if ( !header || !header.startsWith( "Bearer " ) ) {
		return res.status( 401 ).json( { error: "Missing Bearer token" } );
	}

	const token = header.slice( "Bearer ".length );
	try {
		const decoded = verifyToken( token );
		req.steamid = decoded.steamid;
		req.tokenJti = decoded.jti;
		next();
	}
	catch ( err ) {
		return res.status( 401 ).json( { error: "Invalid or expired token" } );
	}
}
