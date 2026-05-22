import { config } from "../config.js";

/**
 * Rate limiter in-memory simple. Une fenêtre glissante par steamid.
 * Pour scaler horizontalement plus tard : remplacer par Redis (incr + expire).
 */
const buckets = new Map(); // steamid -> [timestamps ms]

function pruneAndCount( steamid, now ) {
	const cutoff = now - config.rateLimit.windowMs;
	const arr = buckets.get( steamid ) ?? [];
	let firstFresh = 0;
	while ( firstFresh < arr.length && arr[firstFresh] < cutoff ) firstFresh++;
	const fresh = firstFresh === 0 ? arr : arr.slice( firstFresh );
	buckets.set( steamid, fresh );
	return fresh.length;
}

export function rateLimitMiddleware( req, res, next ) {
	const steamid = req.steamid;
	if ( !steamid ) return next();

	const now = Date.now();
	const count = pruneAndCount( steamid, now );

	if ( count >= config.rateLimit.maxRequests ) {
		return res.status( 429 ).json( {
			error: "Rate limit exceeded",
			retryAfterMs: config.rateLimit.windowMs
		} );
	}

	buckets.get( steamid ).push( now );
	next();
}
