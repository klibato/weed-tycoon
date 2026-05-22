import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { config } from "../config.js";

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

// Garantit que le dossier de la DB existe avant d'ouvrir.
function ensureDir( filePath ) {
	const dir = path.dirname( filePath );
	if ( !fs.existsSync( dir ) ) fs.mkdirSync( dir, { recursive: true } );
}

ensureDir( config.db.path );

export const db = new Database( config.db.path );
db.pragma( "journal_mode = WAL" );
db.pragma( "foreign_keys = ON" );

/**
 * Applique le schema.sql (idempotent grâce aux CREATE TABLE IF NOT EXISTS).
 * Appelé par scripts/migrate.js et au démarrage du serveur.
 */
export function applyMigrations() {
	const schemaPath = path.join( __dirname, "schema.sql" );
	const sql = fs.readFileSync( schemaPath, "utf-8" );
	db.exec( sql );
}

/**
 * Wrap une fonction dans une transaction. Si elle throw, rollback automatique.
 * Usage : runInTransaction(() => { db.prepare(...).run(...); ... })
 */
export function runInTransaction( fn ) {
	const tx = db.transaction( fn );
	return tx();
}
