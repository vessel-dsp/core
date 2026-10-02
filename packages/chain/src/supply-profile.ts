/**
 * Battery supply profiles for {@link RuntimeNode.setSupplyProfile}.
 *
 * A profile is an open-circuit EMF magnitude plus a series resistance. It is
 * applied to the circuit's external supply stamps only (see
 * `resolveSupplyStamps` in `@vessel-dsp/compiler`): derived rails keep their
 * compiled values, and mains-fed rails are refused. There is no audio-domain
 * processing here: no envelope follower, no waveshaper, no extra chain node.
 * The circuit's own current draw through the series resistance is what
 * produces sag inside the solver.
 *
 * Provenance rule: every numeric value below is either the literal
 * "definition" (the ideal source) or a citation of the one opened document,
 * Jack Orman, "9v Battery Impedance", AMZ-FX Lab Notebook, copyright 2015,
 * http://www.muzique.com/lab/batteryz.htm, method: unloaded reading with a
 * Fluke multimeter, then loaded with a 560 ohm resistor, internal resistance
 * by Ohm's law. No adapter profile is listed because no source was found for
 * one (design note section 5). No number from the old PowerSupplyNode is
 * reused.
 */

export type SupplyProfile = {
	readonly id: string;
	readonly name: string;
	/** Open-circuit EMF magnitude in volts, or null to keep the pedal's own declared supply voltage. */
	readonly openCircuitVolts: number | null;
	/** Series resistance in ohms. */
	readonly internalResistanceOhms: number;
	/** A citation (document, year, table, exact values, how a derived number was computed) or the literal "definition". */
	readonly source: string;
};

const IDEAL: SupplyProfile = {
	id: "ideal",
	name: "Ideal supply",
	openCircuitVolts: null,
	internalResistanceOhms: 0,
	source: "definition",
};

const ALKALINE_FRESH: SupplyProfile = {
	id: "alkaline-fresh",
	name: "Fresh alkaline",
	openCircuitVolts: null,
	// (5.99 + 4.82) / 2 = 10.81 / 2 = 5.405.
	internalResistanceOhms: 5.405,
	source:
		"Orman 2015 (http://www.muzique.com/lab/batteryz.htm), fresh table: " +
		"AC-Delco alkaline #1 5.99 ohm and #2 4.82 ohm; " +
		"value is their mean (5.99 + 4.82) / 2 = 5.405 ohm. " +
		"Open-circuit volts null keeps the pedal's own declared supply voltage.",
};

const ZINC_CARBON_FRESH: SupplyProfile = {
	id: "zinc-carbon-fresh",
	name: "Fresh zinc-carbon",
	openCircuitVolts: null,
	// (25.28 + 26.57) / 2 = 51.85 / 2 = 25.925.
	internalResistanceOhms: 25.925,
	source:
		"Orman 2015 (http://www.muzique.com/lab/batteryz.htm), fresh table: " +
		"Sunbeam Heavy Duty #1 25.28 ohm and #2 26.57 ohm; " +
		"value is their mean (25.28 + 26.57) / 2 = 25.925 ohm. " +
		"Open-circuit volts null keeps the pedal's own declared supply voltage.",
};

const ALKALINE_DEPLETED_SPECIMEN: SupplyProfile = {
	id: "alkaline-depleted-specimen",
	name: "Depleted alkaline specimen (single cell, not a type rating)",
	openCircuitVolts: 7.73,
	internalResistanceOhms: 195.0,
	source:
		"Orman 2015 (http://www.muzique.com/lab/batteryz.htm), used table: " +
		"Duracell alkaline #6, unloaded 7.73 V, loaded 6.43 V, 195.00 ohm. " +
		"A single specimen, not a type rating.",
};

const ZINC_CARBON_USED_SPECIMEN: SupplyProfile = {
	id: "zinc-carbon-used-specimen",
	name: "Used zinc-carbon specimen (single cell, not a type rating)",
	openCircuitVolts: 9.02,
	internalResistanceOhms: 78.47,
	source:
		"Orman 2015 (http://www.muzique.com/lab/batteryz.htm), used table: " +
		"Golden Power Heavy Duty #7, unloaded 9.02 V, loaded 7.91 V, 78.47 ohm. " +
		"A single specimen, not a type rating.",
};

/**
 * The five built-in profiles, and only these. Adapter profiles are
 * deliberately absent: no source was found for a regulated 9 V, regulated
 * 18 V, or unregulated AC/DC resistance or voltage.
 */
export const SUPPLY_PROFILES: readonly SupplyProfile[] = [
	IDEAL,
	ALKALINE_FRESH,
	ZINC_CARBON_FRESH,
	ALKALINE_DEPLETED_SPECIMEN,
	ZINC_CARBON_USED_SPECIMEN,
];

function assertFinitePositive(
	value: number,
	label: string,
): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(
			`${label} must be a finite positive number, got ${String(value)}`,
		);
	}
}

/**
 * Build a profile from the caller's own measurement, following Orman's
 * method: read the open-circuit volts E, then the loaded volts across a known
 * resistor Rload, and compute Rint = (Vopen - Vloaded) / (Vloaded / Rload).
 */
export function profileFromMeasurement(input: {
	readonly openCircuitVolts: number;
	readonly loadedVolts: number;
	readonly loadOhms: number;
}): SupplyProfile {
	const { openCircuitVolts, loadedVolts, loadOhms } = input;
	assertFinitePositive(openCircuitVolts, "openCircuitVolts");
	assertFinitePositive(loadedVolts, "loadedVolts");
	assertFinitePositive(loadOhms, "loadOhms");
	if (!(loadedVolts <= openCircuitVolts)) {
		throw new Error(
			`loadedVolts (${String(loadedVolts)}) must not exceed openCircuitVolts (${String(openCircuitVolts)})`,
		);
	}
	const current = loadedVolts / loadOhms;
	const internalResistanceOhms =
		(openCircuitVolts - loadedVolts) / current;
	if (!Number.isFinite(internalResistanceOhms) || internalResistanceOhms < 0) {
		throw new Error(
			`measured internal resistance ${String(internalResistanceOhms)} is not a finite non-negative resistance`,
		);
	}
	return {
		id: "measured",
		name: "Measured supply (caller measurement)",
		openCircuitVolts,
		internalResistanceOhms,
		source:
			`Caller-supplied measurement by Orman's method (Orman 2015, ` +
			`http://www.muzique.com/lab/batteryz.htm): open-circuit ` +
			`${String(openCircuitVolts)} V, loaded ${String(loadedVolts)} V ` +
			`across ${String(loadOhms)} ohm, ` +
			`Rint = (Vopen - Vloaded) / (Vloaded / Rload) = ${String(internalResistanceOhms)} ohm.`,
	};
}

/**
 * Build a profile from caller-supplied numbers (for example a preset
 * round-trip). The source is the caller: no citation is claimed.
 */
export function customSupplyProfile(input: {
	readonly openCircuitVolts: number | null;
	readonly internalResistanceOhms: number;
	readonly name?: string;
}): SupplyProfile {
	const { openCircuitVolts, internalResistanceOhms, name } = input;
	if (openCircuitVolts !== null) {
		if (!Number.isFinite(openCircuitVolts) || openCircuitVolts <= 0) {
			throw new Error(
				`openCircuitVolts must be null or a finite positive number, got ${String(openCircuitVolts)}`,
			);
		}
	}
	if (
		!Number.isFinite(internalResistanceOhms) ||
		internalResistanceOhms < 0
	) {
		throw new Error(
			`internalResistanceOhms must be a finite non-negative resistance, got ${String(internalResistanceOhms)}`,
		);
	}
	const trimmed = name?.trim() ?? "";
	return {
		id: "custom",
		name: trimmed.length > 0 ? trimmed : "Custom supply",
		openCircuitVolts,
		internalResistanceOhms,
		source: "caller-supplied",
	};
}
