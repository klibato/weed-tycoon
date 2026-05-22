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

export const STARTER_STRAINS = {
	starter_kush_classic: {
		genomeHash: "starter_kush_classic",
		strainName: "Kush Classic",
		species: SPECIES.Indica,
		thcPercent: 17,
		cbdPercent: 1,
		terpenePercent: 1.2,
		yieldGramsBase: 120,
		flowerTimeMultiplier: 1,
		heightCm: 110,
		pestResistance: 0.6,
		moldResistance: 0.5,
		heatTolerance: 0.6,
		leafColor: { r: 0.35, g: 0.65, b: 0.30 },
		isAutoflower: false,
		generation: 0,
		isStabilizedIbl: true
	},

	starter_haze_heritage: {
		genomeHash: "starter_haze_heritage",
		strainName: "Haze Heritage",
		species: SPECIES.Sativa,
		thcPercent: 19,
		cbdPercent: 0.5,
		terpenePercent: 1.5,
		yieldGramsBase: 100,
		flowerTimeMultiplier: 1.5,
		heightCm: 240,
		pestResistance: 0.5,
		moldResistance: 0.4,
		heatTolerance: 0.8,
		leafColor: { r: 0.45, g: 0.70, b: 0.35 },
		isAutoflower: false,
		generation: 0,
		isStabilizedIbl: true
	},

	starter_autocadet: {
		genomeHash: "starter_autocadet",
		strainName: "AutoCadet",
		species: SPECIES.Ruderalis,
		thcPercent: 13,
		cbdPercent: 2,
		terpenePercent: 0.9,
		yieldGramsBase: 60,
		flowerTimeMultiplier: 0.85,
		heightCm: 70,
		pestResistance: 0.7,
		moldResistance: 0.7,
		heatTolerance: 0.7,
		leafColor: { r: 0.40, g: 0.60, b: 0.30 },
		isAutoflower: true,
		generation: 0,
		isStabilizedIbl: true
	}
};

export function getStarterStrain( id ) {
	return STARTER_STRAINS[id] ?? null;
}
