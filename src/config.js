import "dotenv/config";

function required( key ) {
	const v = process.env[key];
	if ( !v ) throw new Error( `Missing required env var: ${key}` );
	return v;
}

function intEnv( key, fallback ) {
	const v = process.env[key];
	if ( !v ) return fallback;
	const n = Number.parseInt( v, 10 );
	if ( Number.isNaN( n ) ) throw new Error( `Invalid integer for ${key}: ${v}` );
	return n;
}

function boolEnv( key, fallback ) {
	const v = process.env[key];
	if ( v === undefined ) return fallback;
	return v.toLowerCase() === "true";
}

export const config = {
	port: intEnv( "PORT", 3000 ),
	env: process.env.NODE_ENV ?? "development",
	logLevel: process.env.LOG_LEVEL ?? "info",

	db: {
		path: process.env.DB_PATH ?? "./data/weedtycoon.db"
	},

	auth: {
		jwtSecret: required( "JWT_SECRET" ),
		jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
		hmacResponseSecret: required( "HMAC_RESPONSE_SECRET" )
	},

	steam: {
		apiKey: process.env.STEAM_API_KEY ?? "",
		appId: intEnv( "STEAM_APP_ID", 0 ),
		bypassAuth: boolEnv( "STEAM_AUTH_BYPASS", false )
	},

	rateLimit: {
		windowMs: intEnv( "RATE_LIMIT_WINDOW_MS", 60_000 ),
		maxRequests: intEnv( "RATE_LIMIT_MAX_REQUESTS", 120 )
	},

	radio: {
		// Préfixe absolu utilisé pour construire les URLs publiques des tracks.
		// Prod : "https://api.klbtcorp.cloud/radio/static". Dev local : "http://localhost:3000/radio/static".
		baseUrl: process.env.RADIO_BASE_URL ?? "http://localhost:3000/radio/static",
		// Dossier local sur disque qui contient les .ogg servis par express.static.
		staticDir: process.env.RADIO_STATIC_DIR ?? "./public/radio"
	}
};

export const isDev = config.env === "development";
