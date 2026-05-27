/**
 * Algorithme de croisement (server-authoritative).
 *
 * Mirror du client C# (Code/Cultivation/Breeding.cs). Toute modif ici DOIT être
 * répercutée côté C# et vice-versa, sinon les hashes/lineage divergent et la DB
 * communautaire est polluée.
 *
 * PRNG seedé (mulberry32) : crucial pour anti-cheat. Le seed est dérivé de
 * (steamid + parents + nonce + secret) → le client ne peut pas le prédire.
 */

import { createHash } from "node:crypto";

const MUTATION_CHANCE = 0.05;
const MUTATION_BOOST  = 0.30;
const MIN_SEEDS = 2;
const MAX_SEEDS = 4;

const SPECIES = { Indica: "Indica", Sativa: "Sativa", Ruderalis: "Ruderalis", Hybrid: "Hybrid" };

/**
 * mulberry32 — PRNG déterministe 32 bits. Suffisant pour breeding, jamais pour la crypto.
 */
function mulberry32( seed ) {
	let s = seed >>> 0;
	return function () {
		s = ( s + 0x6D2B79F5 ) >>> 0;
		let t = s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

function gaussZ( rng ) {
	const u1 = 1 - rng();
	const u2 = 1 - rng();
	return Math.sqrt( -2 * Math.log( u1 ) ) * Math.cos( 2 * Math.PI * u2 );
}

function sample( rng, a, b, min, max, varianceMult = 1.0 ) {
	const mean = ( a + b ) * 0.5;
	const baseStddev = Math.abs( a - b ) * 0.5 + Math.abs( mean ) * 0.06;
	const stddev = baseStddev * varianceMult;
	const value = mean + gaussZ( rng ) * stddev;
	return Math.min( max, Math.max( min, value ) );
}

function lerpColor( a, b, t ) {
	return {
		r: a.r + ( b.r - a.r ) * t,
		g: a.g + ( b.g - a.g ) * t,
		b: a.b + ( b.b - a.b ) * t,
	};
}

function lineageOf( p1, p2 ) {
	// v0.3.2 : lineage = juste les 2 parents IMMÉDIATS (leur StrainName canonique).
	// Plus de Union récursive de toute l'ascendance → plus de bloat possible.
	// Self-cross : un seul nom. Cross : sorted alpha pour cohérence cross-joueurs.
	// Le procedural namer gère le strip du F-gen suffix pour les self-crosses.
	const n1 = p1.strainName ?? p1.lineage ?? "?";
	const n2 = p2.strainName ?? p2.lineage ?? "?";
	if ( n1 === n2 ) return n1;
	const sorted = [ n1, n2 ].sort();
	return `${sorted[0]}×${sorted[1]}`;
}

// =========================================================================
// v0.3 Procedural namer — mirror of Code/Cultivation/ProceduralNamer.cs
// Toute modif ici doit matcher côté C# pour cohérence cross-joueurs.
// =========================================================================

const NOUN_POOL = [
	"Skylines", "Mosaic", "Tempest", "Aurora", "Galaxy", "Cascade", "Velvet", "Crescendo",
	"Veil", "Storm", "Prism", "Nebula", "Bloom", "Reverie", "Echo", "Sonata",
	"Tapestry", "Mirage", "Eclipse", "Symphony", "Cosmos", "Horizon", "Maze", "Surge",
	"Pulse", "Petal", "Silk", "Spirit", "Oracle", "Sage", "Runtz", "Glacier",
	"Reverence", "Ember", "Whisper", "Cascade", "Riff", "Sundae", "Cake", "Cookies",
	"Gas", "Punch", "Diamond", "Tide", "Drift", "Halo", "Mist", "Pearl",
	"Comet", "Zephyr"
];

const MUTATION_PREFIX_FALLBACK_POOL = [
	"Purple", "Frosty", "Foxtail", "Sunset", "Royal"
];

/** FNV-1a 32-bit. Doit donner le MÊME résultat que le client C# pour cohérence. */
function fnv1a( s ) {
	let h = 2166136261 >>> 0;
	for ( let i = 0; i < s.length; i++ ) {
		h ^= s.charCodeAt( i );
		h = Math.imul( h, 16777619 ) >>> 0;
	}
	return h;
}

function pickFromPool( pool, seed ) {
	if ( !pool || pool.length === 0 ) return "";
	return pool[ seed % pool.length ];
}

// Strip le " F\d+" ou " IBL F\d+" suffix d'un root. "Cookies F14" → "Cookies", "Kush IBL F8" → "Kush".
// Permet de hasher + nommer cleanly quand les parents sont eux-mêmes des procedural names.
function stripGenSuffix( root ) {
	if ( !root ) return root;
	return root.replace( /\s+IBL\s+F\d+$/i, "" ).replace( /\s+F\d+$/i, "" ).trim();
}

function splitRoots( lineage ) {
	if ( !lineage ) return [];
	return [...new Set(
		lineage.split( "×" ).map( r => stripGenSuffix( r.trim() ) ).filter( r => r.length > 0 )
	)];
}

function normalizeMutationPrefix( mutationType ) {
	if ( !mutationType ) return "";
	const key = mutationType.toLowerCase();
	switch ( key ) {
		case "purple":  return "Purple";
		case "frosty":  return "Frosty";
		case "foxtail": return "Foxtail";
		case "sunset":  return "Sunset";
		case "royal":   return "Royal";
		default:        return pickFromPool( MUTATION_PREFIX_FALLBACK_POOL, fnv1a( mutationType ) );
	}
}

export function generateProceduralName( lineage, generation, mutationType ) {
	if ( !lineage ) lineage = "Unknown";
	const roots = splitRoots( lineage );

	let baseName;
	if ( roots.length <= 1 ) {
		const rootName = roots.length === 1 ? roots[0] : stripGenSuffix( lineage );
		baseName = generation >= 4
			? `${rootName} IBL F${generation}`
			: `${rootName} F${generation}`;
	} else {
		// Hash sur les BASE names (sans F-gen) pour rester stable cross-gen sur une même ligne.
		const hashInput = roots.join( "×" );
		const noun = pickFromPool( NOUN_POOL, fnv1a( hashInput ) );
		baseName = `${noun} F${generation}`;
	}

	if ( mutationType ) {
		const mutPrefix = normalizeMutationPrefix( mutationType );
		if ( mutPrefix ) baseName = `${mutPrefix} ${baseName}`;
	}

	return baseName;
}

function mutationKey( label ) {
	if ( !label ) return null;
	if ( label.includes( "Purple" ) )  return "purple";
	if ( label.includes( "Frosty" ) )  return "frosty";
	if ( label.includes( "Foxtail" ) ) return "foxtail";
	if ( label.includes( "THC" ) )     return "potent";
	if ( label.includes( "CBD" ) )     return "cbd_heavy";
	if ( label.includes( "Terps" ) )   return "terpy";
	if ( label.includes( "Yield" ) )   return "yieldy";
	if ( label.includes( "Fast" ) )    return "fast";
	return "unknown";
}

function applyMutation( rng, g ) {
	const kind = Math.floor( rng() * 8 );
	switch ( kind ) {
		case 0:
			g.thcPercent = Math.min( 35, g.thcPercent * ( 1 + MUTATION_BOOST ) );
			return { genome: g, label: "THC++" };
		case 1:
			g.cbdPercent = Math.min( 25, g.cbdPercent * ( 1 + MUTATION_BOOST ) );
			return { genome: g, label: "CBD++" };
		case 2:
			g.terpenePercent = Math.min( 6, g.terpenePercent * ( 1 + MUTATION_BOOST ) );
			return { genome: g, label: "Terps++" };
		case 3:
			g.yieldGramsBase = Math.min( 1000, g.yieldGramsBase * ( 1 + MUTATION_BOOST ) );
			return { genome: g, label: "Yield++" };
		case 4:
			g.flowerTimeMultiplier = Math.max( 0.7, g.flowerTimeMultiplier * ( 1 - MUTATION_BOOST ) );
			return { genome: g, label: "Fast Flowering" };
		case 5:
			g.leafColor = { r: 0.55, g: 0.20, b: 0.75 };
			return { genome: g, label: "Trait visuel : Purple" };
		case 6:
			g.leafColor = { r: 0.85, g: 0.85, b: 0.95 };
			return { genome: g, label: "Trait visuel : Frosty" };
		case 7:
			g.leafColor = { r: 0.95, g: 0.55, b: 0.25 };
			return { genome: g, label: "Trait visuel : Foxtail Orange" };
	}
	return { genome: g, label: null };
}

/**
 * Hash de bucket : (lineage, mutationType, isAutoflower, species).
 * Mirror du C# Breeding.ComputeGenomeHash. Algorithme volontairement simple
 * (FNV-like sur la concat) pour reproductibilité cross-langage stable.
 */
export function computeGenomeHash( g ) {
	const key = `${g.lineage ?? "?"}|${g.mutationType ?? ""}|${g.species}|${g.isAutoflower ? 1 : 0}`;
	const buf = createHash( "sha256" ).update( key ).digest();
	const u32 = buf.readUInt32LE( 0 );
	return `bred_${u32.toString( 16 ).padStart( 8, "0" )}`;
}

/**
 * Score combiné pour le "best-of" tracking : THC*2 + Yield*0.1 + Terps*5.
 * Détermine si un nouveau roll d'un bucket existant améliore le pheno canonique.
 */
export function computeCombinedScore( g ) {
	return g.thcPercent * 2 + g.yieldGramsBase * 0.1 + g.terpenePercent * 5;
}

/**
 * Croise deux génomes côté serveur, RNG seedé pour anti-cheat.
 *
 * @param {object} parent1
 * @param {object} parent2
 * @param {string} steamid
 * @param {number} nonce
 * @param {string} serverSecret
 * @returns {{childGenome, seedCount, mutated, mutationLabel, combinedScore}}
 */
export function cross( parent1, parent2, steamid, nonce, serverSecret ) {
	const seedSource = `${steamid}|${parent1.genomeHash}|${parent2.genomeHash}|${nonce}|${serverSecret}`;
	const seedBuf = createHash( "sha256" ).update( seedSource ).digest();
	const rng = mulberry32( seedBuf.readUInt32LE( 0 ) );

	// v0.3 : variance reduction par generation (mirror C#). F1=100%, F5=50%, F8=30%, F10+=20%.
	const childGen = Math.max( parent1.generation, parent2.generation ) + 1;
	const varianceMult = Math.max( 0.20, 1 - childGen * 0.10 );

	const child = {
		species: parent1.species === parent2.species ? parent1.species : SPECIES.Hybrid,
		thcPercent:           sample( rng, parent1.thcPercent,     parent2.thcPercent,     1,   35,   varianceMult ),
		cbdPercent:           sample( rng, parent1.cbdPercent,     parent2.cbdPercent,     0,   25,   varianceMult ),
		terpenePercent:       sample( rng, parent1.terpenePercent, parent2.terpenePercent, 0,   6,    varianceMult ),
		yieldGramsBase:       sample( rng, parent1.yieldGramsBase, parent2.yieldGramsBase, 40,  1000, varianceMult ),
		flowerTimeMultiplier: sample( rng, parent1.flowerTimeMultiplier, parent2.flowerTimeMultiplier, 0.7, 1.6, varianceMult ),
		heightCm:             sample( rng, parent1.heightCm,       parent2.heightCm,       30,  360,  varianceMult ),
		pestResistance:       sample( rng, parent1.pestResistance, parent2.pestResistance, 0,   1,    varianceMult ),
		moldResistance:       sample( rng, parent1.moldResistance, parent2.moldResistance, 0,   1,    varianceMult ),
		heatTolerance:        sample( rng, parent1.heatTolerance,  parent2.heatTolerance,  0,   1,    varianceMult ),
		leafColor:            lerpColor( parent1.leafColor, parent2.leafColor, rng() ),
		isAutoflower:         ( parent1.isAutoflower && parent2.isAutoflower )
			|| ( rng() < 0.25 && ( parent1.isAutoflower || parent2.isAutoflower ) ),
		generation:           childGen,
		isStabilizedIbl:      childGen >= 8,
	};

	let mutated = false;
	let mutationLabel = null;
	if ( rng() < MUTATION_CHANCE ) {
		const mut = applyMutation( rng, child );
		mutationLabel = mut.label;
		mutated = !!mutationLabel;
	}

	child.lineage = lineageOf( parent1, parent2 );
	child.mutationType = mutationKey( mutationLabel );

	// v0.3 : nom procédural (mirror C# ProceduralNamer.GenerateName). Plus de "Haze×Kush · Purple"
	// cradeux — maintenant "Royal Skylines F2" / "Purple Galaxy F3" / "Pure Kush IBL F8".
	child.strainName = generateProceduralName( child.lineage, child.generation, child.mutationType );

	child.genomeHash = computeGenomeHash( child );

	const seedCount = MIN_SEEDS + Math.floor( rng() * ( MAX_SEEDS - MIN_SEEDS + 1 ) );

	return {
		childGenome: child,
		seedCount,
		mutated,
		mutationLabel,
		combinedScore: computeCombinedScore( child ),
	};
}
