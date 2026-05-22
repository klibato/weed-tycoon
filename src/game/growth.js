/**
 * Constantes de croissance — mirror du C# Plant.cs.
 * "1 jour IRL = 10 secondes game-time" (1 jour IRL = 10_000 ms).
 *
 * Pour comparer un planted_at_ms avec maintenant, on travaille en ms partout.
 */

export const PHASE_DURATIONS_MS = {
	germination:   30_000,    // 30s
	seedling:      140_000,   // 2m20
	vegetative:    350_000,   // 5m50
	flowering:     560_000,   // 9m20 (indica baseline, × flowerTimeMultiplier)
	harvested:     1_000,     // transition rapide vers drying
	drying:        100_000,   // 1m40
	curing:        280_000    // optionnel, 4m40 max bénéfice
};

export const PHASE_ORDER = [
	"seed",
	"germination",
	"seedling",
	"vegetative",
	"flowering",
	"harvested",
	"drying",
	"ready"
];

/**
 * Calcule la phase actuelle d'une plante donné son état stocké en DB
 * et l'horloge serveur. Server-authoritative : pas de confiance dans
 * le client pour ce calcul.
 */
export function computeCurrentPhase( plant, now ) {
	if ( plant.phase === "dead" || plant.phase === "ready" ) {
		return { phase: plant.phase, progress: 1, phaseStartedAtMs: plant.phase_started_at_ms };
	}

	const flowerMult = JSON.parse( plant.genome_json ).flowerTimeMultiplier ?? 1;
	const isAuto = JSON.parse( plant.genome_json ).isAutoflower ?? false;

	let phase = plant.phase;
	let phaseStartedAtMs = plant.phase_started_at_ms;

	while ( true ) {
		const duration = getPhaseDuration( phase, flowerMult );
		if ( duration <= 0 ) break;

		const elapsed = now - phaseStartedAtMs;
		if ( elapsed < duration ) {
			return { phase, progress: elapsed / duration, phaseStartedAtMs };
		}

		// Phase terminée — quel est le suivant ?
		const next = nextPhase( phase, isAuto, plant.flowering_triggered );
		if ( next === null ) {
			return { phase, progress: 1, phaseStartedAtMs };
		}

		phaseStartedAtMs += duration;
		phase = next;
	}

	return { phase, progress: 1, phaseStartedAtMs };
}

export function getPhaseDuration( phase, flowerMult = 1 ) {
	if ( phase === "flowering" ) return PHASE_DURATIONS_MS.flowering * flowerMult;
	return PHASE_DURATIONS_MS[phase] ?? 0;
}

/**
 * Détermine la phase suivante. null = pas de transition automatique
 * (attente d'une action joueur).
 *   - Vegetative photoperiod : attend trigger flowering manuel
 *   - Flowering : attend harvest manuel
 *   - Curing : attend que le joueur sorte de cure manuellement
 */
function nextPhase( phase, isAuto, floweringTriggered ) {
	switch ( phase ) {
		case "germination": return "seedling";
		case "seedling":    return "vegetative";
		case "vegetative":  return isAuto ? "flowering" : null;
		case "flowering":   return null;  // harvest manuel
		case "harvested":   return "drying";
		case "drying":      return "ready";
		case "curing":      return null;
		default:            return null;
	}
}

export function isMatureForHarvest( plant, now ) {
	if ( plant.phase !== "flowering" ) return false;
	const flowerMult = JSON.parse( plant.genome_json ).flowerTimeMultiplier ?? 1;
	const duration = getPhaseDuration( "flowering", flowerMult );
	const elapsed = now - plant.phase_started_at_ms;
	return elapsed >= duration;
}
