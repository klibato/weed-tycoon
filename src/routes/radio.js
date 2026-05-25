import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../config.js";

const router = Router();

/**
 * Playlist dynamique : scan le dossier config.radio.staticDir à chaque request (cached 60s).
 * Drop un .ogg dans le dossier → il apparaît dans la playlist au prochain refresh.
 *
 * Metadata par track :
 *   - id : basename du fichier sans .ogg (slug)
 *   - title : déduit du basename (underscores → espaces, title-cased) OU lu d'un .json sidecar
 *   - artist : lu d'un .json sidecar (sinon "")
 *   - durationSec : ffprobe au scan (cached)
 *
 * Pour customiser title/artist sur un fichier, crée un .json à côté avec le même basename :
 *   /public/radio/track1.ogg
 *   /public/radio/track1.json   ← { "title": "Cool Song", "artist": "Some Artist" }
 */

const CACHE_TTL_MS = 60_000;
let _cachedPlaylist = null;
let _cachedAt = 0;

function probeDuration( filepath ) {
	try {
		const out = execFileSync( "ffprobe", [
			"-v", "error",
			"-show_entries", "format=duration",
			"-of", "default=noprint_wrappers=1:nokey=1",
			filepath
		], { encoding: "utf8", timeout: 5000 } );
		const n = Number.parseFloat( out.trim() );
		return Number.isFinite( n ) ? Math.round( n ) : 0;
	}
	catch ( e ) {
		console.warn( `[radio] ffprobe failed for ${filepath} : ${e.message}` );
		return 0;
	}
}

function titleFromFilename( filename ) {
	const base = path.parse( filename ).name;
	return base
		.split( /[_\-\s]+/ )
		.filter( s => s.length > 0 )
		.map( w => w[0].toUpperCase() + w.slice( 1 ).toLowerCase() )
		.join( " " );
}

function readSidecar( baseDir, basename ) {
	const sidecarPath = path.join( baseDir, basename + ".json" );
	if ( !fs.existsSync( sidecarPath ) ) return null;
	try {
		return JSON.parse( fs.readFileSync( sidecarPath, "utf8" ) );
	}
	catch ( e ) {
		console.warn( `[radio] sidecar parse failed for ${sidecarPath} : ${e.message}` );
		return null;
	}
}

function buildPlaylist() {
	const baseDir = path.resolve( config.radio.staticDir );
	if ( !fs.existsSync( baseDir ) ) {
		console.warn( `[radio] static dir not found : ${baseDir}` );
		return [];
	}

	const files = fs.readdirSync( baseDir )
		.filter( f => f.toLowerCase().endsWith( ".ogg" ) )
		.sort();

	return files.map( filename => {
		const basename = path.parse( filename ).name;
		const fullPath = path.join( baseDir, filename );
		const sidecar = readSidecar( baseDir, basename );

		return {
			id: basename,
			title: sidecar?.title ?? titleFromFilename( filename ),
			artist: sidecar?.artist ?? "",
			filename,
			durationSec: sidecar?.durationSec ?? probeDuration( fullPath )
		};
	} );
}

function getPlaylist( forceRefresh = false ) {
	const now = Date.now();
	if ( forceRefresh || _cachedPlaylist === null || now - _cachedAt > CACHE_TTL_MS ) {
		_cachedPlaylist = buildPlaylist();
		_cachedAt = now;
	}
	return _cachedPlaylist;
}

/**
 * GET /radio/playlist
 * Liste publique des tracks dispos (no JWT, cache 60s).
 */
router.get( "/playlist", ( _req, res ) => {
	const tracks = getPlaylist().map( t => ( {
		id: t.id,
		title: t.title,
		artist: t.artist,
		url: `${config.radio.baseUrl}/${t.filename}`,
		durationSec: t.durationSec
	} ) );

	res.set( "Cache-Control", "public, max-age=60" );
	res.json( { ok: true, count: tracks.length, tracks } );
} );

/**
 * POST /radio/refresh
 * Force un rescan du dossier (bust le cache 60s). Utile après avoir drop un nouveau .ogg
 * pour le voir immédiatement sans attendre le TTL.
 */
router.post( "/refresh", ( _req, res ) => {
	const playlist = getPlaylist( true );
	res.json( { ok: true, count: playlist.length, tracks: playlist.map( t => t.id ) } );
} );

/**
 * GET /radio/health
 * Sanity-check : liste les fichiers présents + leur size + duration.
 */
router.get( "/health", ( _req, res ) => {
	const baseDir = path.resolve( config.radio.staticDir );
	const playlist = getPlaylist();
	const status = playlist.map( t => {
		const fp = path.join( baseDir, t.filename );
		const exists = fs.existsSync( fp );
		const sizeMB = exists ? +( fs.statSync( fp ).size / ( 1024 * 1024 ) ).toFixed( 1 ) : 0;
		return { id: t.id, filename: t.filename, exists, sizeMB, durationSec: t.durationSec };
	} );
	const allPresent = status.every( s => s.exists );
	res.json( { ok: allPresent, baseDir, count: status.length, tracks: status } );
} );

export default router;
