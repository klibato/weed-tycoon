// Dev give — patch le state backend d'un joueur (test only). CommonJS (.cjs) pour
// tourner standalone malgré package.json type:module. À lancer depuis /opt/weedtycoon-backend.
require( "dotenv" ).config();
const Database = require( "better-sqlite3" );

const STEAMID = process.env.GIVE_STEAMID || "76561198253636976";
const CASH = Number( process.env.GIVE_CASH || 250000 );
const dbPath = process.env.DB_PATH || "./data/weedtycoon.db";

const db = new Database( dbPath );

const row = db.prepare( "SELECT state_json FROM players WHERE steamid = ?" ).get( STEAMID );
if ( !row ) {
	console.error( "NO_PLAYER_ROW " + STEAMID + " (le joueur doit s'être connecté au backend au moins une fois)" );
	process.exit( 1 );
}

let s = {};
try { s = row.state_json ? JSON.parse( row.state_json ) : {}; } catch ( _ ) { s = {}; }

// Unlock all + cash, sans toucher aux seeds / library / placed pots existants.
Object.assign( s, {
	SaveVersion: 2,
	Cash: CASH,
	RoomTier: 5,        // Greenhouse (max)
	LampTier: 4,        // Quantum Board (max)
	HasTrimRobot: true,
	HasCO2System: true,
	HasSprinkler: true,
	HasAutoHarvest: true,
	HasAutoPlanter: true,
	Level: 50,          // débloque tous les gates shop
	TutorialStep: 99,   // tuto marqué terminé
} );
if ( s.SavedAtTicks === undefined ) s.SavedAtTicks = 0;

const now = Date.now();
db.prepare( "UPDATE players SET state_json = ?, state_updated_at = ?, cash = ? WHERE steamid = ?" )
	.run( JSON.stringify( s ), now, CASH, STEAMID );

const check = db.prepare( "SELECT cash, state_updated_at FROM players WHERE steamid = ?" ).get( STEAMID );
console.log(
	"GIVE_OK", JSON.stringify( check ),
	"| cash=" + s.Cash, "room=" + s.RoomTier, "lamp=" + s.LampTier, "level=" + s.Level,
	"| seeds=" + Object.keys( s.SeedInventory || {} ).length,
	"strains=" + ( ( s.BredStrains || [] ).length )
);
