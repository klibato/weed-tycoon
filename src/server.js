import express from "express";
import helmet from "helmet";
import { config, isDev } from "./config.js";
import { applyMigrations } from "./db/index.js";
import { requireAuth } from "./auth/middleware.js";
import { rateLimitMiddleware } from "./utils/ratelimit.js";

import authRoutes from "./routes/auth.js";
import playerRoutes from "./routes/player.js";
import plantRoutes from "./routes/plant.js";
import strainsRoutes from "./routes/strains.js";

// Applique les migrations au démarrage. Idempotent.
applyMigrations();

const app = express();
app.use( helmet() );
app.use( express.json( { limit: "256kb" } ) );

// Logging minimal en dev. Prod : remplacer par un vrai logger plus tard.
if ( isDev ) {
	app.use( ( req, _res, next ) => {
		console.log( `[${new Date().toISOString()}] ${req.method} ${req.path}` );
		next();
	} );
}

// Health (no auth)
app.get( "/health", ( _req, res ) => {
	res.json( {
		status: "ok",
		uptimeSec: Math.floor( process.uptime() ),
		env: config.env,
		now: Date.now()
	} );
} );

// Auth routes (no JWT required, this is where you get one)
app.use( "/auth", authRoutes );

// Toutes les /api/* exigent un JWT valide + rate limit per-steamid
app.use( "/api", requireAuth, rateLimitMiddleware );
app.use( "/api/player", playerRoutes );
app.use( "/api/plant", plantRoutes );
app.use( "/api/strains", strainsRoutes );

// 404 fallback
app.use( ( _req, res ) => {
	res.status( 404 ).json( { error: "Not found" } );
} );

// Error handler global
app.use( ( err, _req, res, _next ) => {
	console.error( "[error]", err );
	res.status( 500 ).json( { error: "Internal server error" } );
} );

app.listen( config.port, () => {
	console.log( `[server] Listening on http://localhost:${config.port} (${config.env})` );
	if ( config.steam.bypassAuth ) {
		console.warn( "[server] ⚠ STEAM_AUTH_BYPASS=true — DEV ONLY, do not deploy like this." );
	}
} );
