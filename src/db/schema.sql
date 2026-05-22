-- =============================================================================
-- Weed Tycoon — Schema initial
-- Toutes les timestamps sont des secondes Unix (epoch). Les "planted_at" sont en
-- millisecondes pour aligner avec DateTime.UtcNow.Ticks côté C# (converti ÷10000).
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------------------------------
-- players : un row par utilisateur Steam authentifié
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
	steamid          TEXT PRIMARY KEY,
	display_name     TEXT,
	cash             REAL NOT NULL DEFAULT 1000.0,
	last_nonce       INTEGER NOT NULL DEFAULT 0,
	state_json       TEXT,                                       -- full player state blob (cash + tiers + equip + inventories + placedPots + stats)
	state_updated_at INTEGER NOT NULL DEFAULT 0,                 -- unix ms du dernier state push
	created_at       INTEGER NOT NULL DEFAULT ( strftime( '%s', 'now' ) ),
	updated_at       INTEGER NOT NULL DEFAULT ( strftime( '%s', 'now' ) )
);

-- Migration idempotente pour les bases existantes : ajoute les colonnes manquantes.
-- SQLite : pas de IF NOT EXISTS dans ALTER, on tente et on ignore l'erreur si déjà présent.

-- -----------------------------------------------------------------------------
-- plants : chaque plante possédée actuellement ou historiquement
-- Le state est server-authoritative : planted_at_ms et phase_started_at_ms ne
-- peuvent JAMAIS être modifiés par le client.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plants (
	id                  TEXT PRIMARY KEY,
	owner               TEXT NOT NULL,
	genome_json         TEXT NOT NULL,       -- JSON serialise du StrainGenome
	phase               TEXT NOT NULL DEFAULT 'germination',
	planted_at_ms       INTEGER NOT NULL,    -- ms depuis epoch
	phase_started_at_ms INTEGER NOT NULL,
	flowering_triggered INTEGER NOT NULL DEFAULT 0,
	harvested_grams     REAL,
	quality_multiplier  REAL NOT NULL DEFAULT 1.0,
	created_at          INTEGER NOT NULL DEFAULT ( strftime( '%s', 'now' ) ),
	updated_at          INTEGER NOT NULL DEFAULT ( strftime( '%s', 'now' ) ),
	FOREIGN KEY ( owner ) REFERENCES players( steamid )
);
CREATE INDEX IF NOT EXISTS idx_plants_owner ON plants( owner );
CREATE INDEX IF NOT EXISTS idx_plants_phase ON plants( phase );

-- -----------------------------------------------------------------------------
-- player_inventory : graines, nutriments, items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_inventory (
	steamid    TEXT NOT NULL,
	item_type  TEXT NOT NULL,   -- ex: "seed:starter_kush_classic", "nutrient:grow"
	quantity   INTEGER NOT NULL,
	PRIMARY KEY ( steamid, item_type ),
	FOREIGN KEY ( steamid ) REFERENCES players( steamid )
);

-- -----------------------------------------------------------------------------
-- strains : souches uniques registered par la communauté (M2+)
-- Le hash est calculé côté backend par hash(genome_normalized + steamid).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strains (
	hash              TEXT PRIMARY KEY,
	name              TEXT NOT NULL UNIQUE,
	first_discoverer  TEXT NOT NULL,
	genome_json       TEXT NOT NULL,
	bag_appeal        REAL NOT NULL,
	generation        INTEGER NOT NULL,
	registered_at     INTEGER NOT NULL DEFAULT ( strftime( '%s', 'now' ) ),
	FOREIGN KEY ( first_discoverer ) REFERENCES players( steamid )
);
CREATE INDEX IF NOT EXISTS idx_strains_appeal ON strains( bag_appeal DESC );

-- -----------------------------------------------------------------------------
-- action_log : audit trail pour debug cheating + analytics
-- Tronquer périodiquement (ex: > 30 jours)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_log (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	steamid      TEXT NOT NULL,
	action       TEXT NOT NULL,
	payload_json TEXT,
	result_json  TEXT,
	error        TEXT,
	ts_ms        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_steam_ts ON action_log( steamid, ts_ms DESC );
CREATE INDEX IF NOT EXISTS idx_log_ts ON action_log( ts_ms DESC );
