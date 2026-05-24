import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const router = Router();

/**
 * GET /radio/playlist
 * Liste publique des radio tracks. Pas de JWT requis — c'est juste de la musique d'ambiance,
 * pas de donnée sensible. Le client polle ça à l'ouverture du radio overlay.
 *
 * Response shape :
 * {
 *   ok: true,
 *   tracks: [
 *     { id, title, artist, url, durationSec },
 *     ...
 *   ]
 * }
 *
 * Le client peut faire un cache local pendant la session (~60s TTL recommandé).
 */
const TRACKS = [
	{
		id: "whispers_jazz_noir",
		title: "Whispers & Jazz",
		artist: "Vintage 1940s Noir",
		filename: "whispers_jazz_noir.ogg",
		durationSec: 3600
	},
	{
		id: "go_home",
		title: "Go Home",
		artist: "C wyne Nalukalala & Manson Bulubembe",
		filename: "go_home.ogg",
		durationSec: 220
	},
	{
		id: "i_chase_the_devil",
		title: "I Chase the Devil",
		artist: "Max Romeo",
		filename: "i_chase_the_devil.ogg",
		durationSec: 410
	},
	{
		id: "alborosie_waan_the_herb",
		title: "Waan The Herb",
		artist: "Alborosie feat. Michael Rose",
		filename: "alborosie_waan_the_herb.ogg",
		durationSec: 222
	}
];

router.get( "/playlist", ( _req, res ) => {
	const tracks = TRACKS.map( t => ( {
		id: t.id,
		title: t.title,
		artist: t.artist,
		url: `${config.radio.baseUrl}/${t.filename}`,
		durationSec: t.durationSec
	} ) );

	// Cache court côté CDN/edge pour réduire le load DB-less.
	res.set( "Cache-Control", "public, max-age=60" );
	res.json( { ok: true, tracks } );
} );

/**
 * GET /radio/health
 * Sanity-check : confirme que les .ogg existent bien sur disque.
 * Retourne la liste des trackId présents/manquants côté fichiers.
 */
router.get( "/health", ( _req, res ) => {
	const baseDir = path.resolve( config.radio.staticDir );
	const status = TRACKS.map( t => {
		const fp = path.join( baseDir, t.filename );
		const exists = fs.existsSync( fp );
		const sizeMB = exists ? +( fs.statSync( fp ).size / ( 1024 * 1024 ) ).toFixed( 1 ) : 0;
		return { id: t.id, filename: t.filename, exists, sizeMB };
	} );
	const allPresent = status.every( s => s.exists );
	res.json( { ok: allPresent, baseDir, tracks: status } );
} );

export default router;
