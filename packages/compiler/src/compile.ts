// The pipeline: `.vdsp` source text -> a program, or an explanation of the refusal.
//
// Seven stages, composed. The registry is a parameter rather than an import, so the
// compiler holds no knowledge of any specific part -- and compiling with an empty
// registry is a legitimate configuration that measures what works with no part
// knowledge at all.

import {
	attachDeviceLaws,
	composeMacroBlocks,
	findElectricallyIsolatedIcs,
	findIcsNotExecuted,
	findUnimplementedDeviceLaws,
	JFET_DEFAULT_THRESHOLD_VOLTS,
	JFET_DEFAULT_TRANSCONDUCTANCE,
	SILICON_FORWARD_BETA,
	SILICON_SATURATION_CURRENT,
} from "./device-laws";
import {
	findMultiDeviceShells,
	findUnreadableTerminalRoles,
} from "./unreadable-terminal-role";
import { findUnexecutedRegions } from "./unexecuted-region";
import { deriveBypass } from "./bypass";
import { applyConverterScale } from "./converter-scale";
import { couple } from "./couple";
import { type Artifact, emit } from "./emit";
import { StageRefusal } from "./errors";
import { findInertControls } from "./inert-controls";
import { link } from "./link";
import { lower } from "./lower";
import { readNetlist } from "./netlist";
import { partition } from "./partition";
import { emptyRegistry, foldPartId, registryEntryFor, type PartEntry, type PartRegistry } from "./registry";
import {
	findDanglingActiveTerminals,
	synthesizeOpampImplicitBias,
} from "./dangling-active-terminal";
import { findOverDrivenNodes } from "./over-driven-node";
import { findSupplyShorts } from "./supply-short";
import { findUnreachableOutput } from "./unreachable-output";
import { findPowerDomainControls } from "./power-domain-control";
import { findUnimplementedControlRoles } from "./unimplemented-control-role";
import { findUnverifiedPinoutBindings } from "./unverified-pinout";
import { findGenericTubeFits } from "./generic-tube-fit";
import { findGroundedClockSupplies } from "./grounded-clock-supply";
import { findNonExecutableClockDrivers } from "./non-executable-clock-drivers";
import { parseLedIndicatorColour } from "@vessel-dsp/core";
import { GROUND } from "./types";
import type {
	BjtLawDefaultWarning,
	DiodeLawDefaultWarning,
	OpampGainBandwidthDefaultWarning,
	OpampSupplyUndeclaredItem,
	OpampSupplyUndeclaredWarning,
	OpampLawDefaultItem,
	OpampLawDefaultWarning,
	CompileResult,
	DeclaredDelayWarning,
	DeviceId,
	DeviceLaw,
	FetLawDefaultWarning,
	LawedNetlist,
	LedColourUnmatchedWarning,
	ModulationNotModelledWarning,
	Netlist,
	NodeId,
	Program,
	RailWithoutVoltageWarning,
	RegistryOverrideAppliedWarning,
	RegistryProvisionalValueWarning,
} from "./types";
import { findUnboundedOpamps } from "./unbounded-operating-point";

export type CompileOptions = {
	readonly registry?: PartRegistry;
	readonly inputJack?: string;
	readonly outputJack?: string;
};

/**
 * Compile, or explain the refusal. This never throws for a document it cannot use.
 *
 * A stage raises a `StageRefusal` when the *source* does not support a program, and
 * that becomes a result rather than an exception: one malformed packet must not take
 * down a batch, and "could not read the document" is an answer a caller can act on.
 *
 * Anything else propagates. A compiler bug reported as an unsupported pedal would be
 * a wrong answer about someone's circuit, so the catch is deliberately narrow.
 */
export function compile(
	source: string,
	options: CompileOptions = { registry: emptyRegistry },
): CompileResult {
	try {
		return run(source, options);
	} catch (error) {
		if (!(error instanceof StageRefusal)) {
			throw error;
		}
		return {
			status: "unsupported",
			reasons: [
				{ stage: error.stage, device: error.device, reason: error.message },
			],
		};
	}
}

function run(source: string, options: CompileOptions): CompileResult {
	const netlist = readNetlist(source, {
		inputJack: options.inputJack,
		outputJack: options.outputJack,
		registry: options.registry ?? emptyRegistry,
	});
	const lawed: LawedNetlist = attachDeviceLaws(
		netlist,
		options.registry ?? emptyRegistry,
	);

	// Decision 1: an unmodellable device makes the whole pedal/amp unsupported, and
	// the refusal names every component and reason rather than the first one.
	const unsupported = lawed.resolutions.filter(
		(resolution) => resolution.outcome === "unsupported",
	);
	if (unsupported.length > 0) {
		return {
			status: "unsupported",
			reasons: unsupported.map((resolution) => ({
				stage: "device-laws" as const,
				device: resolution.device,
				reason: resolution.outcome === "unsupported" ? resolution.reason : "",
			})),
		};
	}

	const partitioning = partition(lawed);
	const lowered = lower(partitioning, lawed);
	// Stage 5.5: a macro's `coupled`/`parameter` ports reference other blocks, so wiring them
	// happens once every region has one, not while `lower` is still producing them one at a time.
	// `couple` also corrects the dependency graph's audio-out edge (clause 3, the region
	// schedule) -- `link` must sort against that corrected graph, not stage 4's original one, or
	// a coupled seam's downstream side would be free to run before the macro that feeds it.
	const coupled = couple(lowered, partitioning, lawed);
	const bypass = deriveBypass(netlist);
	// Stage 5.75 (board-p3 row 4): the three decomposed models execute as
	// catalog-parameterized compositions. Unconditional since board-p3 row 7 deleted the
	// dispatched kernels: there is no second route to emit, and both runtimes refuse a
	// `macro` block by name rather than execute one.
	const composed = composeMacroBlocks(coupled.blocks);
	const linked: Program = link(
		composed,
		{ ...partitioning, dependencies: coupled.dependencies },
		netlist.controls,
		netlist.ports,
		netlist.portImpedanceOhms,
		netlist.portDeclaredFullScaleVolts,
		bypass,
	);
	// Stage 6.5: an op-amp the topology leaves genuinely undefined (no DC path back to its
	// inverting input, or none from its non-inverting input to any reference) gets an implicit
	// bias so its operating point is bounded rather than left to whatever `gmin` alone settles
	// into -- see `dangling-active-terminal.ts`'s "implicit op-amp DC-bias synthesis" section.
	// Every later Program-consuming stage below reads the bridged program, because that is the
	// one the runtime will actually execute.
	// Stage 6.75: a composed program between two converters takes their full-scale ratio as its
	// level, or says why it cannot. Read from the catalog by exact part id and found by
	// connectivity, so nothing about it is declared in the document.
	const scaled = applyConverterScale(
		synthesizeOpampImplicitBias(linked),
		netlist,
		options.registry ?? emptyRegistry,
	);
	const program: Program = scaled.program;
	// A program with no blocks has nothing to execute, so calling it `ok` reports a
	// compiled pedal that can only ever render silence. `boss-ps-2` reaches here: its
	// jacks and ground are wired and its 223 electrically active parts declare no
	// terminals, so every one is correctly dropped and nothing is left to solve.
	if (program.blocks.length === 0) {
		return {
			status: "unsupported",
			reasons: [
				{
					stage: "link",
					device: null,
					reason:
						"no component contributes to the signal path, so the program has nothing to execute",
				},
			],
		};
	}
	// Strict Admission: Floating wipers or completely disconnected devices are genuine structural
	// defects in the source capture that must be refused. Controls in unscheduled blocks (e.g.
	// unselected channels or scope exclusions documented in packet boundary) remain warnings.
	const inertControls = findInertControls(netlist, program);
	const structuralDefects = inertControls.filter((w) => w.isStructuralDefect);
	if (structuralDefects.length > 0) {
		return {
			status: "unsupported",
			reasons: structuralDefects.map((w) => ({
				stage: "link" as const,
				device: (w.devices && w.devices.length > 0) ? w.devices[0] : null,
				reason: w.detail,
			})),
		};
	}

	// Warnings are computed only for a program that exists and whose controls are connected.
	return {
		status: "ok",
		program,
		warnings: [
			...(netlist.warnings ?? []),
			...inertControls.filter((w) => !w.isStructuralDefect),
			...findUnboundedOpamps(netlist),
			...findSupplyShorts(netlist),
			...findOverDrivenNodes(program),
			...findDanglingActiveTerminals(program),
			...findGroundedClockSupplies(program),
			...findNonExecutableClockDrivers(netlist, options.registry ?? emptyRegistry),
			...findGenericTubeFits(netlist, options.registry ?? emptyRegistry),
			...findUnverifiedPinoutBindings(netlist, options.registry ?? emptyRegistry),
			...findPowerDomainControls(
				netlist,
				program.controls ?? [],
				[netlist.ports.input, netlist.ports.output].filter(
					(node): node is number => typeof node === "number",
				),
			),
			...findUnimplementedControlRoles(program.controls ?? []),
			...findElectricallyIsolatedIcs(netlist),
			...findIcsNotExecuted(
				lawed,
				netlist,
				options.registry ?? emptyRegistry,
			),
			...findUnreadableTerminalRoles(lawed),
			...findMultiDeviceShells(lawed),
			...findUnimplementedDeviceLaws(lawed),
			...findUnreachableOutput(program, netlist),
			...findUnexecutedRegions(program),
			...findDeclaredDelays(program),
			...findUnmodelledModulation(program),
		...findRailsWithoutVoltage(netlist),
		...findFetLawDefaults(netlist, options.registry ?? emptyRegistry),
		...findBjtLawDefaults(netlist, options.registry ?? emptyRegistry),
		...findDiodeLawDefaults(netlist, options.registry ?? emptyRegistry),
		...findRegistryProvisionalValues(netlist, lawed, options.registry ?? emptyRegistry),
		...findLedColourUnmatched(netlist, lawed),
		...findRegistryOverrideApplied(netlist, lawed, options.registry ?? emptyRegistry),
		...findOpampLawDefaults(lawed),
		...findOpampGainBandwidthDefaults(lawed),
		...findOpampSupplyUndeclared(lawed),
		...scaled.warnings,
		],
	};
}

/**
 * Delay macros whose modulation input the part declares and the document wires, but which
 * admission refused -- so the delay is a constant and whatever sweeps it in the real pedal does
 * not reach it.
 *
 * This is the difference between a flanger and a fixed comb filter, and the two compiled to
 * indistinguishable programs. The refusal itself is correct -- gate 1b measured that an
 * LFO-swept clock is a signal rather than a control-rate parameter -- but a correct refusal that
 * nobody is told about renders a pedal doing none of what it is named for.
 */
function findUnmodelledModulation(
	program: Program,
): readonly ModulationNotModelledWarning[] {
	return program.blocks.flatMap((block) =>
		(block.kind === "macro" || block.kind === "composed") &&
		typeof block.modulationRefusal === "string"
			? [
					{
						code: "modulation-not-modelled" as const,
						device: null,
						detail:
							`${block.id} declares a modulation input this document wires, but ` +
							`${block.modulationRefusal}. ` +
							// The consequence is not the same in both cases, and saying the wrong
							// one discredits the warning: a delay that derives from its own clock
							// network still works, it just cannot be swept.
							(block.clockControl != null || block.delayProvenance === "derived"
								? "Its delay still follows its own clock network, but nothing in the " +
									"circuit can sweep it."
								: "Its delay is therefore a constant, and whatever sweeps it in the " +
									"real pedal does not reach it."),
					},
				]
			: [],
	);
}

/**
 * Delay macros whose delay time was typed into the source instead of derived from the clock
 * network they are wired to.
 *
 * A derived delay is a consequence of the packet's own R and C: change either and it moves, and
 * a wrong value shows up as a wrong delay. A declared `DelayMs` renders exactly what it says and
 * is therefore unfalsifiable by any render -- which is precisely why it must not pass silently.
 * The two were indistinguishable in the program until now, so a reader could not tell a
 * simulated delay from a reported one.
 */
function findDeclaredDelays(program: Program): readonly DeclaredDelayWarning[] {
	return program.blocks.flatMap((block) =>
		(block.kind === "macro" || block.kind === "composed") &&
		block.delayProvenance === "declared"
			? [
					{
						code: "declared-delay-not-derived" as const,
						device: null,
						detail:
							`${block.id} runs ${block.modelId} at ` +
							`${((block.parameters.delaySeconds ?? 0) * 1000).toFixed(1)} ms taken from the ` +
							`source's declared DelayMs, not derived from a clock network: ` +
							`${block.delayDeclaredReason ?? "no reason recorded"}. That number renders ` +
							`whatever it says, so it is not evidence about this circuit's delay time.`,
					},
				]
			: [],
	);
}

/** Voltage-less rails that something is connected to. See `RailWithoutVoltageWarning`. */
function findRailsWithoutVoltage(netlist: Netlist): readonly RailWithoutVoltageWarning[] {
	const loaded = new Map<NodeId, number>();
	for (const device of netlist.devices) {
		for (const node of new Set(device.nodes)) loaded.set(node, (loaded.get(node) ?? 0) + 1);
	}
	return netlist.devices.flatMap((device) => {
		if (device.kind !== "rail") return [];
		const volts = device.parameters.volts;
		if (volts !== undefined && Number.isFinite(volts)) return [];
		const attached = [...new Set(device.nodes)].filter(
			(node) => node !== GROUND && (loaded.get(node) ?? 0) > 1,
		);
		if (attached.length === 0) return [];
		return [
			{
				code: "rail-without-voltage" as const,
				device: device.id,
				detail:
					`${device.id} declares no voltage, so it asserts nothing and lowers open; ` +
					`${attached.length === 1 ? `node ${attached[0]} has` : `nodes ${attached.join(", ")} have`} ` +
					"other devices attached, and they see only gmin to ground. A supply the sheet draws " +
					"there solves at 0 V.",
			},
		];
	});
}

/**
 * Whether the registry supplies a parameter for a part: an entry of that law kind matches
 * the exact folded part id (the rung `device-laws.ts` refines on) and its record states the
 * parameter rather than gap-filling it. See `PartEntry.citedParams`. A device that falls
 * through here runs that parameter on the class default.
 */
function registryStates(
	registry: PartRegistry,
	partNumber: string | null,
	lawKind: DeviceLaw["kind"],
	parameter: string,
): boolean {
	if (partNumber === null) return false;
	const folded = foldPartId(partNumber);
	for (const entry of registry.entries) {
		if (!entry.partIds.some((id) => foldPartId(id) === folded)) continue;
		if (entry.model.kind !== "law" || entry.model.law.kind !== lawKind) continue;
		return entry.citedParams === undefined || entry.citedParams.includes(parameter);
	}
	return false;
}

/** JFETs stamped with the fet law's own defaults. See `FetLawDefaultWarning`. */
function findFetLawDefaults(
	netlist: Netlist,
	registry: PartRegistry,
): readonly FetLawDefaultWarning[] {
	// A parameter the document types, or the registry states for the exact part, does not
	// run on the class default. A registered part whose record states neither Vt0 nor Beta
	// (`2SK30A` states only its gate) still does, and is named for exactly those.
	const missingOf = (device: Netlist["devices"][number]) =>
		[
			device.parameters.thresholdVolts === undefined &&
			!registryStates(registry, device.identity.partNumber, "fet", "thresholdVolts")
				? "Vt0"
				: null,
			device.parameters.transconductance === undefined &&
			!registryStates(registry, device.identity.partNumber, "fet", "transconductance")
				? "Beta"
				: null,
		].filter((name) => name !== null);
	const defaulted = netlist.devices.filter(
		(device) => device.kind === "jfet" && missingOf(device).length > 0,
	);
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((device) => {
		const part = device.identity.partNumber;
		return `${device.id}${part === null ? "" : ` (${part})`} without ${missingOf(device).join("/")}`;
	});
	return [
		{
			code: "fet-law-default-parameters" as const,
			device: null,
			devices: defaulted.map((device) => device.id),
			detail:
				`${defaulted.length} JFET(s) run on the fet law's own defaults ` +
				`(Vt0 ${JFET_DEFAULT_THRESHOLD_VOLTS} V, Beta ${JFET_DEFAULT_TRANSCONDUCTANCE * 1e3} mS), ` +
				`which are not any part's values: ${listed.join("; ")}. Harmless for a switch that is ` +
				"fully on or off; decisive for one biased near its knee.",
		},
	];
}

/** BJTs stamped with the bjt law's own defaults. See `BjtLawDefaultWarning`. */
function findBjtLawDefaults(
	netlist: Netlist,
	registry: PartRegistry,
): readonly BjtLawDefaultWarning[] {
	// The same test as the JFET finder: a parameter the document types or the registry
	// states for the exact part is not a default. A record that states only BF (nineteen
	// do) leaves IS on the class default, and is named for IS alone.
	const missingOf = (device: Netlist["devices"][number]) =>
		[
			device.parameters.saturationCurrent === undefined &&
			!registryStates(registry, device.identity.partNumber, "bjt", "saturationCurrent")
				? "IS"
				: null,
			device.parameters.beta === undefined &&
			!registryStates(registry, device.identity.partNumber, "bjt", "forwardBeta")
				? "BF"
				: null,
		].filter((name) => name !== null);
	const defaulted = netlist.devices.filter(
		(device) => device.kind === "bjt" && missingOf(device).length > 0,
	);
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((device) => {
		const part = device.identity.partNumber;
		return `${device.id}${part === null ? "" : ` (${part})`} without ${missingOf(device).join("/")}`;
	});
	return [
		{
			code: "bjt-law-default-parameters" as const,
			device: null,
			devices: defaulted.map((device) => device.id),
			detail:
				`${defaulted.length} BJT(s) run on the bjt law's own defaults ` +
				`(IS ${SILICON_SATURATION_CURRENT} A, BF ${SILICON_FORWARD_BETA}), ` +
				`which are not any part's values: ${listed.join("; ")}. Harmless for a saturated ` +
				"switch; decisive for a biased stage.",
		},
	];
}

/** Diodes stamped with the diode law's own defaults. See `DiodeLawDefaultWarning`. */
function findDiodeLawDefaults(
	netlist: Netlist,
	registry: PartRegistry,
): readonly DiodeLawDefaultWarning[] {
	// The same test as the BJT finder: a parameter the document types or the registry
	// states for the exact part is not a default. LEDs share the diode device kind
	// but run on their colour defaults (a different claim), so they are excluded;
	// zeners and tube diodes are different kinds and never reach this filter.
	const missingOf = (device: Netlist["devices"][number]) =>
		[
			device.parameters.saturationCurrent === undefined &&
			!registryStates(registry, device.identity.partNumber, "diode", "saturationCurrent")
				? "IS"
				: null,
			device.parameters.emissionCoefficient === undefined &&
			!registryStates(registry, device.identity.partNumber, "diode", "emissionCoefficient")
				? "N"
				: null,
			device.parameters.seriesResistance === undefined &&
			!registryStates(registry, device.identity.partNumber, "diode", "seriesResistance")
				? "RS"
				: null,
		].filter((name) => name !== null);
	const defaulted = netlist.devices.filter(
		(device) =>
			device.kind === "diode" && device.isLed !== true && missingOf(device).length > 0,
	);
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((device) => {
		const part = device.identity.partNumber;
		return `${device.id}${part === null ? "" : ` (${part})`} without ${missingOf(device).join("/")}`;
	});
	return [
		{
			code: "diode-law-default-parameters" as const,
			device: null,
			devices: defaulted.map((device) => device.id),
			detail:
				`${defaulted.length} diode(s) run on the diode law's own defaults ` +
				`(IS 2.52e-9 A, N 1.752, RS 1.0 ohm), ` +
				`which are not any part's values: ${listed.join("; ")}. Harmless for a hard-switched ` +
				"or reverse-blocking diode; decisive for one biased at its knee.",
		},
	];
}

/**
 * The registry entry carrying a provisional value for an exact folded part id, or
 * `null`. Part ids only -- never a declared type or pinout signature -- the same rung
 * `device-laws.ts` refines discrete laws on. Entries with no `provisionalParams` can
 * never warn and are skipped.
 */
function provisionalEntryFor(
	registry: PartRegistry,
	partNumber: string,
): PartEntry | null {
	const folded = foldPartId(partNumber);
	for (const entry of registry.entries) {
		if ((entry.provisionalParams?.length ?? 0) === 0) continue;
		if (entry.partIds.some((id) => foldPartId(id) === folded)) return entry;
	}
	return null;
}

/**
 * The document-typed parameter key that overrides a registry parameter for a device
 * kind, or `null` when no typed spelling exists (the entry value always stamps).
 * BJT `forwardBeta` is `beta` in the document; every other overlaid parameter shares
 * the registry name. JFET/MOSFET gate terms have no typed spelling at all.
 */
const PROVISIONAL_OVERRIDE_KEYS: Readonly<
	Record<string, Readonly<Record<string, string | null>>>
> = {
	bjt: {
		saturationCurrent: "saturationCurrent",
		forwardBeta: "beta",
		reverseBeta: "reverseBeta",
		thermalVoltage: "thermalVoltage",
		leakageAmps: "leakageAmps",
	},
	diode: {
		saturationCurrent: "saturationCurrent",
		emissionCoefficient: "emissionCoefficient",
		thermalVoltage: "thermalVoltage",
		breakdownVolts: "breakdownVolts",
		seriesResistance: "seriesResistance",
	},
	jfet: {
		thresholdVolts: "thresholdVolts",
		transconductance: "transconductance",
		channelLengthModulation: null,
		subthresholdVolts: null,
		gateSaturationCurrent: null,
		gateOnsetVolts: null,
		gateScaleVolts: null,
	},
	mosfet: {
		thresholdVolts: "thresholdVolts",
		transconductance: "transconductance",
		channelLengthModulation: null,
		subthresholdVolts: null,
		gateSaturationCurrent: null,
		gateOnsetVolts: null,
		gateScaleVolts: null,
	},
	opamp: {
		openLoopGain: "openLoopGain",
		gainBandwidthHz: "gainBandwidthHz",
		outputSwingDropHighVolts: null,
		outputSwingDropLowVolts: null,
	},
};

/**
 * The registry value an override replaces for one parameter, or `null` when it replaces
 * nothing: either the part has no registry entry at all, the entry states no such
 * parameter (a measured refinement beyond the entry, or a law the entry does not carry),
 * or the declared-device path never reads that parameter from the registry.
 *
 * The last case is `openLoopGain` on a declared op-amp: `device-laws.ts` takes it from the
 * document's typed key or the class default and never consults the registry (a sections
 * entry's figure feeds only the sections expansion, which an override cannot reach -- see
 * `sectionDevices`). Reporting the entry's figure as "replaced" would claim a replacement
 * that never happened; `null` with the detail prose is the honest answer.
 *
 * Read from the entry's law fields by schema name -- law fields ARE schema names -- from a
 * whole `law` entry or the first section of a `sections` entry (a dual op-amp's numbers live
 * there, which is also how `registryOpampGainBandwidth` reads them). Macros and other models
 * carry no numeric law fields for these classes, so they read as absent.
 */
function registryParamValue(
	registry: PartRegistry,
	partNumber: string | null,
	parameter: string,
): number | null {
	if (partNumber === null) {
		return null;
	}
	// See the doc comment: the declared-opamp path never reads openLoopGain from the registry.
	if (parameter === "openLoopGain") {
		return null;
	}
	const entry = registryEntryFor(
		registry,
		{ partId: partNumber, evidence: "exact-part" },
	);
	if (entry === null) {
		return null;
	}
	// A parameter the record does not state is a gap-fill, not a registry value.
	if (entry.citedParams !== undefined && !entry.citedParams.includes(parameter)) {
		return null;
	}
	const law =
		entry.model.kind === "law"
			? entry.model.law
			: entry.model.kind === "sections"
				? entry.model.sections[0]?.law
				: undefined;
	if (law === undefined) {
		return null;
	}
	const value = (law as Record<string, unknown>)[parameter];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Devices whose stamped values came from an explicit `DeviceOverride` block rather than the
 * registry or a class default. See `RegistryOverrideAppliedWarning`. One notice per device,
 * naming the part, every overridden parameter with the override value and the registry value
 * it replaced (null = "no registry entry"), and the provenance -- so a player can show
 * "measured by ... on ...".
 *
 * A notice, never a refusal: the values already stamped (precedence override > legacy typed
 * key > registry > class default). A device whose resolution is not a law (unsupported,
 * macro, open) took no registry value and is not listed.
 */
function findRegistryOverrideApplied(
	netlist: Netlist,
	lawed: LawedNetlist,
	registry: PartRegistry,
): readonly RegistryOverrideAppliedWarning[] {
	const lawedByBase = new Set(
		lawed.resolutions
			.filter((resolution) => resolution.outcome === "law")
			.map((resolution) => resolution.device.replace(/#\d+$/, "")),
	);
	const out: RegistryOverrideAppliedWarning[] = [];
	for (const device of netlist.devices) {
		const override = device.deviceOverride;
		if (override === undefined) continue;
		if (!lawedByBase.has(device.id)) continue;
		const partNumber = device.identity.partNumber;
		const items = override.parameters.map((parameter) => ({
			parameter: parameter.name,
			overrideValue: parameter.value,
			registryValue: registryParamValue(registry, partNumber, parameter.name),
		}));
		const stated = items
			.map(
				(item) =>
					`${item.parameter} ${item.overrideValue}` +
					(item.registryValue === null
						? " (no registry value replaced)"
						: ` (registry ${item.registryValue})`),
			)
			.join(", ");
		out.push({
			code: "registry-override-applied" as const,
			device: device.id,
			partNumber,
			items,
			provenance: override.provenance,
			detail:
				`${device.id}${partNumber === null ? "" : ` (${partNumber})`} applies a ` +
				`${override.provenance.kind} override by ${override.provenance.by} on ` +
				`${override.provenance.date}: ${stated}.`,
		});
	}
	return out;
}
/**
 * Devices whose stated `Color` is outside the closed colour vocabulary. See
 * `LedColourUnmatchedWarning`. One warning per device, naming the device and quoting
 * the value verbatim: the device keeps the LED class defaults, and the spelling stays
 * the packet's problem to fix. Scoped like the provisional-value notice -- a device
 * whose resolution is not a law took no default and is not listed.
 */
function findLedColourUnmatched(
	netlist: Netlist,
	lawed: LawedNetlist,
): readonly LedColourUnmatchedWarning[] {
	const lawedByBase = new Set(
		lawed.resolutions
			.filter((resolution) => resolution.outcome === "law")
			.map((resolution) => resolution.device.replace(/#\d+$/, "")),
	);
	const out: LedColourUnmatchedWarning[] = [];
	for (const device of netlist.devices) {
		if (device.isLed !== true) continue;
		const stated = device.ledColour;
		if (stated === undefined || stated === null) continue;
		if (parseLedIndicatorColour(stated) !== undefined) continue;
		if (!lawedByBase.has(device.id)) continue;
		out.push({
			code: "led-colour-unmatched" as const,
			device: device.id,
			value: stated,
			detail:
				`${device.id} states Color "${stated}", which is outside the closed LED ` +
				`colour vocabulary (red, yellow, green, blue, white, compared whole and ` +
				`case-sensitively). The device keeps the LED class defaults; no colour ` +
				`law is keyed, nothing is normalised or inferred.`,
		});
	}
	return out;
}

/**
 * Devices whose law runs on at least one provisional `community` registry value.
 * See `RegistryProvisionalValueWarning`. One warning per device, naming the device,
 * the part, the taken parameters and the distinct source URLs: a notice, never a
 * refusal. A device whose document types a parameter runs on its own typed value for
 * that parameter and is not listed for it. A device whose resolution is not a law
 * (unsupported, macro, open) took no registry value and is not listed.
 */
function findRegistryProvisionalValues(
	netlist: Netlist,
	lawed: LawedNetlist,
	registry: PartRegistry,
): readonly RegistryProvisionalValueWarning[] {
	const lawedByBase = new Set(
		lawed.resolutions
			.filter((resolution) => resolution.outcome === "law")
			.map((resolution) => resolution.device.replace(/#\d+$/, "")),
	);
	const out: RegistryProvisionalValueWarning[] = [];
	for (const device of netlist.devices) {
		const partNumber = device.identity.partNumber;
		if (partNumber === null) continue;
		if (!lawedByBase.has(device.id)) continue;
		const entry = provisionalEntryFor(registry, partNumber);
		if (entry === null) continue;
		const overrides = PROVISIONAL_OVERRIDE_KEYS[device.kind] ?? {};
		const taken = (entry.provisionalParams ?? []).filter((param) => {
			const override = overrides[param.name];
			if (override === null) return true;
			const key = override ?? param.name;
			return device.parameters[key] === undefined;
		});
		if (taken.length === 0) continue;
		const parameters = taken.map((param) => param.name);
		const urls = [...new Set(taken.map((param) => param.url))];
		out.push({
			code: "registry-provisional-value" as const,
			device: device.id,
			partNumber,
			parameters,
			urls,
			detail:
				`${device.id} (${partNumber}) runs on provisional community value(s) ` +
				`${parameters.join(", ")} from ${urls.join(", ")}. A published model or ` +
				`single-author measurement, not a datasheet, manufacturer model or owner ` +
				`measurement; the pedal still renders, and the value stands until a better ` +
				`source replaces it.`,
		});
	}
	return out;
}

/**
 * Op-amps whose output swing the part does not state at this pedal's supply. See
 * `OpampLawDefaultWarning`.
 *
 * A package is lowered as one law per section, so a device is judged across all its sections:
 * `not-stated` if any section carries no printed pair; otherwise `stated-at-other-supply` if the
 * lowering carried the pair at a supply span other than the one it was printed at (compared to
 * 1e-9 V). A pair used at exactly its printed supply, and a stated pair the lowering did not carry
 * (unrailed op-amp, a pair that would close the interval), list nothing: no figure crossed a supply.
 */
function findOpampLawDefaults(lawed: LawedNetlist): readonly OpampLawDefaultWarning[] {
	const byId = new Map(lawed.netlist.devices.map((device) => [device.id, device]));
	type Judgement = { stated: boolean; carried: { printed: number; circuit: number } | null };
	const judged = new Map<string, Judgement>();
	for (const resolution of lawed.resolutions) {
		if (resolution.outcome !== "law") continue;
		const kind = resolution.law.kind;
		if (kind !== "ideal-opamp" && kind !== "power-amp") continue;
		// A section of a package is lowered as `<device>#<index>`; the warning names the device.
		const id = resolution.device.replace(/#\d+$/, "");
		const law = resolution.law;
		const section = judged.get(id) ?? { stated: true, carried: null };
		if (law.kind === "power-amp") {
			// A power-amp section states no swing pair by construction (no printable
			// figure), so it always counts as unstated here, exactly like an op-amp
			// without drops.
			section.stated = false;
		} else {
			section.stated = section.stated && law.outputSwingPrinted !== undefined;
			if (
				section.carried === null &&
				law.outputSwingPrinted !== undefined &&
				law.outputSwingCarried !== undefined &&
				Math.abs(law.outputSwingCarried.circuitSupplyVolts - law.outputSwingPrinted.supplyVolts) > 1e-9
			) {
			section.carried = {
				printed: law.outputSwingPrinted.supplyVolts,
				circuit: law.outputSwingCarried.circuitSupplyVolts,
			};
			}
		}
		judged.set(id, section);
	}
	const items: OpampLawDefaultItem[] = [];
	for (const [id, section] of judged) {
		if (!section.stated) {
			items.push({ device: id as DeviceId, reason: "not-stated" });
		} else if (section.carried !== null) {
			items.push({
				device: id as DeviceId,
				reason: "stated-at-other-supply",
				printedSupplyVolts: section.carried.printed,
				circuitSupplyVolts: section.carried.circuit,
			});
		}
	}
	if (items.length === 0) return [];
	const label = (id: string) => {
		const part = byId.get(id)?.identity.partNumber ?? null;
		return `${id}${part === null ? "" : ` (${part})`}`;
	};
	const notStated = items.filter((item) => item.reason === "not-stated");
	const carried = items.filter((item) => item.reason === "stated-at-other-supply");
	const parts: string[] = [];
	if (notStated.length > 0) {
		parts.push(
			`${notStated.length} op-amp(s) swing the full supply because the part states no ` +
				`output-swing drop: ${notStated.map((item) => label(item.device)).join("; ")}`,
		);
	}
	if (carried.length > 0) {
		parts.push(
			`${carried.length} op-amp(s) carry a datasheet swing printed at another supply: ` +
				carried
					.map((item) =>
						item.reason === "stated-at-other-supply"
							? `${label(item.device)} printed at ${item.printedSupplyVolts} V, carried to ${item.circuitSupplyVolts} V`
							: "",
					)
					.join("; "),
		);
	}
	return [
		{
			code: "opamp-law-default-parameters" as const,
			device: null,
			devices: items.map((item) => item.device),
			items,
			detail: `${parts.join(". ")}. Harmless for a stage that never nears the rails; decisive for a comparator, an LFO or a clipper.`,
		},
	];
}

/**
 * Railed op-amp sections whose gain-bandwidth product no source states. See
 * `OpampGainBandwidthDefaultWarning`.
 *
 * A section is lowered as `<device>#<index>`, so each resolution is one section and the warning
 * names the package once. A compandor's internal op-amp is one more section under the compandor's
 * own id: its law carries no product, and the stamp `lower.ts` builds from it is `null`.
 */
function findOpampGainBandwidthDefaults(
	lawed: LawedNetlist,
): readonly OpampGainBandwidthDefaultWarning[] {
	const byId = new Map(lawed.netlist.devices.map((device) => [device.id, device]));
	const sections = new Map<string, number>();
	for (const resolution of lawed.resolutions) {
		if (resolution.outcome !== "law") continue;
		const law = resolution.law;
		if (law.kind !== "ideal-opamp" && law.kind !== "compandor" && law.kind !== "power-amp") continue;
		if (law.kind !== "compandor" && law.gainBandwidthHz !== undefined) continue;
		if (law.railHigh === null || law.railLow === null) continue;
		const id = resolution.device.replace(/#\d+$/, "");
		sections.set(id, (sections.get(id) ?? 0) + 1);
	}
	if (sections.size === 0) return [];
	const total = [...sections.values()].reduce((sum, count) => sum + count, 0);
	const listed = [...sections].map(([id, count]) => {
		const part = byId.get(id)?.identity.partNumber ?? null;
		return `${id}${part === null ? "" : ` (${part})`}${count > 1 ? ` x${count}` : ""}`;
	});
	return [
		{
			code: "opamp-gain-bandwidth-default" as const,
			device: null,
			devices: [...sections.keys()] as unknown as OpampGainBandwidthDefaultWarning["devices"],
			sections: total,
			detail:
				`${total} op-amp section(s) run on the consoles' class-default 1 MHz gain-bandwidth ` +
				`product because no source states one: ${listed.join("; ")}. A stage of gain G rolls off ` +
				"at GBP / G, so a wrong product moves the high-frequency droop of a high-gain stage.",
		},
	];
}

/**
 * Op-amps with a declared supply terminal on a node whose voltage the document does not state.
 * See `OpampSupplyUndeclaredWarning`.
 *
 * Read from the lowered ideal-op-amp laws, where `attachDeviceLaws` recorded the terminals it could
 * not resolve; a package split into sections repeats the list on every section, so the items are
 * deduplicated by parent device, side and node.
 */
function findOpampSupplyUndeclared(
	lawed: LawedNetlist,
): readonly OpampSupplyUndeclaredWarning[] {
	const byId = new Map(lawed.netlist.devices.map((device) => [device.id, device]));
	const seen = new Set<string>();
	const items: OpampSupplyUndeclaredItem[] = [];
	for (const resolution of lawed.resolutions) {
		if (resolution.outcome !== "law") continue;
		if (resolution.law.kind !== "ideal-opamp" && resolution.law.kind !== "power-amp") continue;
		const id = resolution.device.replace(/#\d+$/, "");
		for (const pin of resolution.law.supplyUnresolved ?? []) {
			const key = `${id}\n${pin.side}\n${pin.node}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({ device: id as DeviceId, side: pin.side, node: pin.node });
		}
	}
	if (items.length === 0) return [];
	const label = (id: string) => {
		const part = byId.get(id)?.identity.partNumber ?? null;
		return `${id}${part === null ? "" : ` (${part})`}`;
	};
	const devices = [...new Set(items.map((item) => item.device))];
	return [
		{
			code: "opamp-supply-undeclared" as const,
			device: null,
			devices,
			items,
			detail:
				`${devices.length} op-amp(s) declare a supply terminal on a node no rail, source, regulator, ` +
				`charge pump or zener states a voltage for, so that side runs on the circuit-wide supply: ` +
				`${items.map((item) => `${label(item.device)} ${item.side === "high" ? "positive" : "negative"} supply on node ${item.node}`).join("; ")}. ` +
				"Harmless where the node is a plain tap of that supply; decisive for a comparator, an LFO or a clipper " +
				"powered from a divided or regulated node, which swings the whole supply instead of its own.",
		},
	];
}

export function compileToArtifact(
	source: string,
	options: CompileOptions,
): { readonly result: CompileResult; readonly artifact: Artifact | null } {
	const result = compile(source, options);
	return {
		result,
		artifact: result.status === "ok" ? emit(result.program) : null,
	};
}
