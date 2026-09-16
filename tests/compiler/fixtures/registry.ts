// Fake part registries.
//
// The registry is an injected parameter, so a fake is not a mock -- it is a
// legitimate configuration. `emptyRegistry` in particular is the arbitrary-schematic
// case: what compiles when the compiler knows about no parts at all.
//
// No real part numbers. `FIXTURE-DELAY-1` exists nowhere outside these tests, which
// keeps the identity assertions away from anything the corpus contains.
//
// **A fictional part, but not a fictional model.** `modelId` names the DSP algorithm a
// runtime must implement, not the chip (see `MacroModel.modelId`), so the fixture part's
// model is the real `bucket-brigade-delay-line` a real MN3007 entry would also name. Making
// it fictional too would mean the only implemented model in the runtime existed for tests.

import type { MacroPartModel, PartEntry, PartRegistry } from "@vessel-dsp/compiler";

const fixtureDelayMacro: MacroPartModel = {
	modelId: "bucket-brigade-delay-line",
	parameters: { stages: 1024 },
	// Addressed by role rather than by index, which is what lets one entry serve documents that
	// order the same pinout differently. The fixture's own terminals are named to match.
	ports: {
		audioIn: ["in"],
		audioOut: ["out", "out1"],
		parameter: ["cp1", "clock1"],
	},
	// A `coupled` port on both audio terminals: 47k in (a sampling-cap-and-bias-network
	// stand-in), 1k out (a buffered source). Neither is a real MN3005 measurement --
	// this part exists nowhere outside these tests -- but both are nonzero and
	// declared, so the loading is real rather than a zero default nothing measured.
	audioPortImpedanceOhms: { input: 47_000, output: 1_000 },
	parameterReferenceVolts: 9,
};

/** The part's identity, shared by both macro registries below so only the model differs. */
const fixtureDelayIdentity: Omit<PartEntry, "model"> = {
	partIds: ["FIXTURE-DELAY-1"],
	declaredTypes: ["Circuit.FixtureDelayMemory"],
	terminalRoleGroups: [
		["cp1", "clock1"],
		["vgg", "gatebias"],
	],
};

/** Knows one macro model, by exact part id, declared type, and pinout. */
export const fixtureRegistry: PartRegistry = {
	entries: [
		{
			...fixtureDelayIdentity,
			model: { kind: "macro", macro: fixtureDelayMacro },
		},
	],
};

/**
 * The same part, declaring a DSP algorithm no runtime implements.
 *
 * The negative control for the model lockout, and it is the whole point of that lockout: a
 * compander is a real thing a real chip in a real pedal does, it is not a delay line, and
 * before `modelId` was dispatched on at all it would have *executed* as one -- plausible,
 * silent and completely wrong. Only the `modelId` differs from `fixtureRegistry`, so a program
 * built from this is identical in every other respect -- same pinout, same ports, same
 * schedule, same stamps -- and whatever refuses it can only be refusing the model.
 */
export const unimplementedMacroRegistry: PartRegistry = {
	entries: [
		{
			...fixtureDelayIdentity,
			model: {
				kind: "macro",
				macro: { ...fixtureDelayMacro, modelId: "compander" },
			},
		},
	],
};

/**
 * The fixture part as the `digital-delay-line` model, with feedback regeneration.
 *
 * The positive control for the runtime's dispatch: same identity, same ports, same schedule as
 * `fixtureRegistry` above, differing only in the algorithm name and the one parameter that model
 * carries (`feedback`). A `digital-delay-line` that rendered as a plain delay would be the
 * same plausible-wrong-pedal defect the `compander` lockout above pins, so this is the case that
 * must regenerate.
 */
export const digitalDelayLineRegistry: PartRegistry = {
	entries: [
		{
			...fixtureDelayIdentity,
			model: {
				kind: "macro",
				macro: {
					...fixtureDelayMacro,
					modelId: "digital-delay-line",
					parameters: { feedback: 0.6 },
				},
			},
		},
	],
};

/** The `digital-delay-line` model with no regeneration: the plain-delay negative control. */
export const digitalDelayLineDryRegistry: PartRegistry = {
	entries: [
		{
			...fixtureDelayIdentity,
			model: {
				kind: "macro",
				macro: {
					...fixtureDelayMacro,
					modelId: "digital-delay-line",
					parameters: { feedback: 0 },
				},
			},
		},
	],
};

/**
 * Mock ICs for the parity gate (`scripts/report-fixture-spice-parity.ts`).
 *
 * Every chip in the corpus carrying a law that gate cannot reach is a `macro`: a BBD, a delay
 * memory, a compandor. A macro is lifted out of the solver and executed as DSP, so ngspice has
 * no circuit to compare against one and no fixture can change that. `sections` is the other
 * thing a registry can say -- the chip expands into ordinary device laws that stay in the
 * matrix -- and that is the path most of the corpus's registry-expanded devices actually take.
 * These entries exist so that path has fixtures.
 *
 * Fictional part numbers, like every entry in this file. The *laws* are real: a mock law would
 * mean the gate graded behaviour no pedal runs.
 */
export const sectionsRegistry: PartRegistry = {
	entries: [
		{
			// One op-amp on an eight-pin package. The point of comparison is `invertingAmplifier`,
			// which is the same circuit with the op-amp declared as `kind: opamp` instead: if the
			// packaged one disagrees and the discrete one agrees, the defect is in expansion.
			partIds: ["PKG-OPAMP-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					{
						law: { kind: "ideal-opamp", railHigh: null, railLow: null, openLoopGain: 1e5 },
						terminals: [0, 1, 2],
					},
				],
			},
		},
		{
			/**
			 * An optocoupler / Vactrol: an LED facing a light-dependent resistor.
			 *
			 * `optocoupler` is four corpus packets -- the Fender tremolos -- and it is a stamp in
			 * the matrix rather than a lifted macro, which is what makes it referenceable at all.
			 * The LDR's resistance falls exponentially with LED current, so wiring the LED to the
			 * signal makes the row grade that coupling curve rather than one point on it.
			 *
			 * The `ldrMinOhms` / `ldrMaxOhms` span is the part fact here. `ledThresholdVolts` and
			 * `ledTransconductance` are *not*: both are required by the law's type and neither
			 * runtime reads them -- see
			 * docs/troubleshootings/an-optocouplers-declared-led-parameters-are-not-executed.md.
			 */
			partIds: ["PKG-OPTO-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					{
						law: {
							kind: "optocoupler",
							ledThresholdVolts: 1.6,
							ledTransconductance: 0.001,
							ldrMinOhms: 1000,
							ldrMaxOhms: 100_000,
						},
						terminals: [0, 1, 2, 3],
					},
				],
			},
		},
		{
			/**
			 * A CMOS transmission gate: a conductance between two signal pins, set by a third.
			 *
			 * `analog-switch` is two corpus packets and had no fixture. The law is a smooth
			 * sigmoid rather than a hard throw -- `gOff + (gOn - gOff) / (1 + exp(-10 * (vCtrl -
			 * Vth)))` -- so it has a curve to grade rather than two states, which is why an
			 * ngspice `S` element would be the wrong reference for it.
			 */
			partIds: ["PKG-SWITCH-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					{
						// Threshold at 0 V so the fixture's own signal drives the gate across the
						// curve. A CD4066's real threshold sits mid-rail; this one is placed where
						// the sigmoid is steepest, because a row biased hard on would grade the
						// on-resistance and never the law.
						law: { kind: "analog-switch", onOhms: 125, offOhms: 1e6, thresholdVolts: 0 },
						terminals: [0, 1, 2],
					},
				],
			},
		},
		{
			/**
			 * An open-collector comparator: the output is pulled toward `vee` or left floating.
			 *
			 * `comparator` is one corpus packet. Like the analog switch it is a sigmoid, not a
			 * step: `gOn / (1 + exp(k * vDiff)) + gOff` between output and `vee`. A fourth
			 * terminal would name `vee`; three leaves it at ground, which is the common wiring.
			 */
			partIds: ["PKG-COMPARATOR-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				sections: [
					{
						// A soft comparator, and every number here is chosen against a measurement.
						// Sensitivity 8 rather than a decisive several hundred spans the sigmoid
						// smoothly at this fixture's 0.1 V drive instead of producing switching
						// edges, whose *timing* a fixed-step runtime and an adaptive-step ngspice
						// resolve differently for reasons that are not the law. The 22:1 on/off
						// conductance ratio is likewise deliberate: at the stiffer 1e4:1 first
						// tried, the runtime's Newton failed to converge on 120 samples and the row
						// reported `unconverged`, which says nothing about the comparator.
						law: { kind: "comparator", pullDownOhms: 2200, floatOhms: 1e4, sensitivity: 8 },
						terminals: [0, 1, 2],
					},
				],
				pinout: [null, null, null, null, null, null, null, null],
			},
		},
		{
			/**
			 * The four-terminal OTA: the one the corpus actually uses.
			 *
			 * A fourth mapped terminal is an amplifier-bias pin, and its presence is what selects
			 * the nonlinear part over the linear fallback. The bias pin sinks a diode current to
			 * `vee` -- unmapped here, so ground -- and that current sets the output's scale, so a
			 * declaration error in the bias pin changes the gain rather than nothing. The output
			 * is `2 * Iabc * tanh(vDiff / 2Vt)`: compressive by construction, which is the whole
			 * reason a phaser built on one sounds like a phaser.
			 */
			partIds: ["PKG-OTA-NL-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					{
						// `transconductance` is unread on this path: with a bias terminal the scale
						// comes from `Iabc`, not from a declared gm. It is required by the law's type.
						law: { kind: "ota", transconductance: 1e-3 },
						terminals: [0, 1, 2, 3],
					},
				],
			},
		},
		{
			// A transconductor: output current is gm times the input difference. `ota` is 5 corpus
			// packets and has no fixture at all, because every real OTA arrives inside an `ic`.
			partIds: ["PKG-OTA-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					{
						law: { kind: "ota", transconductance: 1e-3 },
						terminals: [0, 1, 2],
					},
				],
			},
		},
	],
};

/** Knows one part as a lumped law rather than a macro model. */
export const resistiveChipRegistry: PartRegistry = {
	entries: [
		{
			partIds: ["FIXTURE-RESISTIVE-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: { kind: "law", law: { kind: "conductance", siemens: 1e-4 } },
		},
	],
};

/**
 * Knows one multi-section part: a fictional dual op-amp on eight pins.
 *
 * The shape real dual op-amps take, without a real part number. Sections index the device's own
 * terminals, so pins 4 and 7 -- the supply pins -- appear in no section and contribute nothing,
 * which is correct: an `ideal-opamp` resolves its rails from the circuit's supply set rather than
 * from its own pins.
 */
export const dualOpampRegistry: PartRegistry = {
	entries: [
		{
			partIds: ["FIXTURE-DUAL-OPAMP-1"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				// The fixture chip numbers its pins (`pin1`..`pin8`), and `terminalRoleToken` returns
				// null for a bare pin number, so there is nothing to check and every position is
				// unchecked. That is the honest encoding: the guard exists to catch a document whose
				// *named* terminals disagree with the entry, and this one names none.
				pinout: [null, null, null, null, null, null, null, null],
				sections: [
					// plus, minus, output -- the canonical order for an op-amp section. The rails are
					// null here and substituted from the circuit's supply set at expansion, because a
					// registry describes a part and the rails belong to the pedal it is fitted to.
					{
						law: {
							kind: "ideal-opamp",
							railHigh: null,
							railLow: null,
							// The part's own gain; only the rails come from the pedal.
							openLoopGain: 2e5,
						},
						terminals: [0, 1, 2],
					},
					{
						law: {
							kind: "ideal-opamp",
							railHigh: null,
							railLow: null,
							// The part's own gain; only the rails come from the pedal.
							openLoopGain: 2e5,
						},
						terminals: [5, 4, 3],
					},
				],
			},
		},
	],
};
