/**
 * Starter strains — mirror du C# StrainGenome.cs. Toute modification ici DOIT
 * être répercutée dans Code/Cultivation/StrainGenome.cs (et vice-versa). Plus tard
 * on pourrait générer les deux depuis un JSON commun.
 */

export const SPECIES = {
	Indica: "Indica",
	Sativa: "Sativa",
	Ruderalis: "Ruderalis",
	Hybrid: "Hybrid"
};

function starter( {
	hash, name, species, thc, cbd, terps, yieldG, flo, height,
	pest, mold, heat, leafColor, auto = false,
} ) {
	return {
		genomeHash: hash,
		strainName: name,
		lineage: name,
		phenoLabel: "Original",
		species,
		thcPercent: thc,
		cbdPercent: cbd,
		terpenePercent: terps,
		yieldGramsBase: yieldG,
		flowerTimeMultiplier: flo,
		heightCm: height,
		pestResistance: pest,
		moldResistance: mold,
		heatTolerance: heat,
		leafColor,
		isAutoflower: auto,
		generation: 0,
		isStabilizedIbl: true,
		mutationType: null,
	};
}

export const STARTER_STRAINS = Object.freeze( {
	// Tier 1 — accessibles dès le départ
	starter_kush_classic: starter( {
		hash: "starter_kush_classic", name: "Kush Classic", species: SPECIES.Indica,
		thc: 17, cbd: 1, terps: 1.2, yieldG: 120, flo: 1, height: 110,
		pest: 0.6, mold: 0.5, heat: 0.6, leafColor: { r: 0.35, g: 0.65, b: 0.30 },
	} ),
	starter_haze_heritage: starter( {
		hash: "starter_haze_heritage", name: "Haze Heritage", species: SPECIES.Sativa,
		thc: 19, cbd: 0.5, terps: 1.5, yieldG: 100, flo: 1.5, height: 240,
		pest: 0.5, mold: 0.4, heat: 0.8, leafColor: { r: 0.45, g: 0.70, b: 0.35 },
	} ),
	starter_autocadet: starter( {
		hash: "starter_autocadet", name: "AutoCadet", species: SPECIES.Ruderalis,
		thc: 13, cbd: 2, terps: 0.9, yieldG: 60, flo: 0.85, height: 70,
		pest: 0.7, mold: 0.7, heat: 0.7, leafColor: { r: 0.40, g: 0.60, b: 0.30 }, auto: true,
	} ),
	starter_purple_punch: starter( {
		hash: "starter_purple_punch", name: "Purple Punch", species: SPECIES.Indica,
		thc: 20, cbd: 0.8, terps: 2.1, yieldG: 110, flo: 0.95, height: 100,
		pest: 0.55, mold: 0.45, heat: 0.5, leafColor: { r: 0.45, g: 0.20, b: 0.65 },
	} ),

	// Pool étendu — strains réels
	starter_northern_lights: starter( {
		hash: "starter_northern_lights", name: "Northern Lights", species: SPECIES.Indica,
		thc: 18, cbd: 0.5, terps: 1.4, yieldG: 175, flo: 0.95, height: 110,
		pest: 0.75, mold: 0.7, heat: 0.5, leafColor: { r: 0.30, g: 0.55, b: 0.30 },
	} ),
	starter_og_kush: starter( {
		hash: "starter_og_kush", name: "OG Kush", species: SPECIES.Hybrid,
		thc: 22, cbd: 0.3, terps: 2.0, yieldG: 140, flo: 1.0, height: 140,
		pest: 0.55, mold: 0.5, heat: 0.6, leafColor: { r: 0.35, g: 0.60, b: 0.30 },
	} ),
	starter_sour_diesel: starter( {
		hash: "starter_sour_diesel", name: "Sour Diesel", species: SPECIES.Sativa,
		thc: 22, cbd: 0.2, terps: 1.8, yieldG: 150, flo: 1.35, height: 210,
		pest: 0.55, mold: 0.5, heat: 0.7, leafColor: { r: 0.40, g: 0.65, b: 0.30 },
	} ),
	starter_wedding_cake: starter( {
		hash: "starter_wedding_cake", name: "Wedding Cake", species: SPECIES.Hybrid,
		thc: 24, cbd: 0.3, terps: 2.5, yieldG: 130, flo: 1.0, height: 130,
		pest: 0.6, mold: 0.55, heat: 0.55, leafColor: { r: 0.40, g: 0.55, b: 0.35 },
	} ),
	starter_gelato: starter( {
		hash: "starter_gelato", name: "Gelato", species: SPECIES.Hybrid,
		thc: 22, cbd: 0.2, terps: 2.3, yieldG: 140, flo: 1.05, height: 150,
		pest: 0.55, mold: 0.55, heat: 0.55, leafColor: { r: 0.42, g: 0.58, b: 0.45 },
	} ),
	starter_granddaddy_purple: starter( {
		hash: "starter_granddaddy_purple", name: "Granddaddy Purple", species: SPECIES.Indica,
		thc: 19, cbd: 0.5, terps: 1.9, yieldG: 160, flo: 0.95, height: 130,
		pest: 0.65, mold: 0.5, heat: 0.5, leafColor: { r: 0.50, g: 0.25, b: 0.55 },
	} ),
	starter_pineapple_express: starter( {
		hash: "starter_pineapple_express", name: "Pineapple Express", species: SPECIES.Hybrid,
		thc: 19, cbd: 0.3, terps: 1.7, yieldG: 150, flo: 0.95, height: 160,
		pest: 0.6, mold: 0.55, heat: 0.65, leafColor: { r: 0.50, g: 0.65, b: 0.30 },
	} ),
	starter_blueberry: starter( {
		hash: "starter_blueberry", name: "Blueberry", species: SPECIES.Indica,
		thc: 18, cbd: 0.5, terps: 1.6, yieldG: 130, flo: 1.0, height: 120,
		pest: 0.65, mold: 0.6, heat: 0.45, leafColor: { r: 0.35, g: 0.45, b: 0.60 },
	} ),
	starter_white_widow: starter( {
		hash: "starter_white_widow", name: "White Widow", species: SPECIES.Hybrid,
		thc: 20, cbd: 0.4, terps: 1.8, yieldG: 140, flo: 1.0, height: 130,
		pest: 0.7, mold: 0.65, heat: 0.6, leafColor: { r: 0.65, g: 0.75, b: 0.55 },
	} ),
	starter_gorilla_glue: starter( {
		hash: "starter_gorilla_glue", name: "Gorilla Glue #4", species: SPECIES.Hybrid,
		thc: 25, cbd: 0.3, terps: 2.2, yieldG: 170, flo: 1.05, height: 150,
		pest: 0.6, mold: 0.55, heat: 0.6, leafColor: { r: 0.40, g: 0.55, b: 0.30 },
	} ),
	starter_critical_mass: starter( {
		hash: "starter_critical_mass", name: "Critical Mass", species: SPECIES.Indica,
		thc: 20, cbd: 1.0, terps: 1.4, yieldG: 250, flo: 0.95, height: 110,
		pest: 0.5, mold: 0.35, heat: 0.55, leafColor: { r: 0.35, g: 0.62, b: 0.30 },
	} ),
	starter_amnesia_haze: starter( {
		hash: "starter_amnesia_haze", name: "Amnesia Haze", species: SPECIES.Sativa,
		thc: 21, cbd: 0.3, terps: 1.7, yieldG: 130, flo: 1.4, height: 220,
		pest: 0.55, mold: 0.5, heat: 0.75, leafColor: { r: 0.42, g: 0.70, b: 0.32 },
	} ),
} );

export function getStarterStrain( id ) {
	return STARTER_STRAINS[id] ?? null;
}
