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
const MIN_SEEDS = 3;
const MAX_SEEDS = 8;

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

function sample( rng, a, b, min, max ) {
	const mean = ( a + b ) * 0.5;
	const stddev = Math.abs( a - b ) * 0.5 + Math.abs( mean ) * 0.06;
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
	// Self-cross : même strain → garde le nom canonique du parent.
	if ( ( p1.strainName ?? p1.lineage ) === ( p2.strainName ?? p2.lineage ) ) {
		return p1.lineage ?? p1.strainName ?? "?";
	}
	const names = [
		p1.lineage ?? p1.strainName ?? "?",
		p2.lineage ?? p2.strainName ?? "?",
	].sort();
	return `${names[0]}×${names[1]}`;
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

	const child = {
		species: parent1.species === parent2.species ? parent1.species : SPECIES.Hybrid,
		thcPercent:           sample( rng, parent1.thcPercent,     parent2.thcPercent,     1,   35 ),
		cbdPercent:           sample( rng, parent1.cbdPercent,     parent2.cbdPercent,     0,   25 ),
		terpenePercent:       sample( rng, parent1.terpenePercent, parent2.terpenePercent, 0,   6 ),
		yieldGramsBase:       sample( rng, parent1.yieldGramsBase, parent2.yieldGramsBase, 40,  1000 ),
		flowerTimeMultiplier: sample( rng, parent1.flowerTimeMultiplier, parent2.flowerTimeMultiplier, 0.7, 1.6 ),
		heightCm:             sample( rng, parent1.heightCm,       parent2.heightCm,       30,  360 ),
		pestResistance:       sample( rng, parent1.pestResistance, parent2.pestResistance, 0,   1 ),
		moldResistance:       sample( rng, parent1.moldResistance, parent2.moldResistance, 0,   1 ),
		heatTolerance:        sample( rng, parent1.heatTolerance,  parent2.heatTolerance,  0,   1 ),
		leafColor:            lerpColor( parent1.leafColor, parent2.leafColor, rng() ),
		isAutoflower:         ( parent1.isAutoflower && parent2.isAutoflower )
			|| ( rng() < 0.25 && ( parent1.isAutoflower || parent2.isAutoflower ) ),
		generation:           Math.max( parent1.generation, parent2.generation ) + 1,
		isStabilizedIbl:      false,
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
	child.strainName = child.mutationType
		? `${child.lineage} · ${mutationLabel}`
		: child.lineage;
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
