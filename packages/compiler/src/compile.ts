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
import { emptyRegistry, type PartRegistry } from "./registry";
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
import { GROUND } from "./types";
import type {
	BjtLawDefaultWarning,
	OpampLawDefaultWarning,
	CompileResult,
	DeclaredDelayWarning,
	FetLawDefaultWarning,
	LawedNetlist,
	ModulationNotModelledWarning,
	Netlist,
	NodeId,
	Program,
	RailWithoutVoltageWarning,
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
		...findFetLawDefaults(netlist),
		...findBjtLawDefaults(netlist),
		...findOpampLawDefaults(lawed),
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

/** JFETs stamped with the fet law's own defaults. See `FetLawDefaultWarning`. */
function findFetLawDefaults(netlist: Netlist): readonly FetLawDefaultWarning[] {
	const defaulted = netlist.devices.filter(
		(device) =>
			device.kind === "jfet" &&
			(device.parameters.thresholdVolts === undefined ||
				device.parameters.transconductance === undefined),
	);
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((device) => {
		const missing = [
			device.parameters.thresholdVolts === undefined ? "Vt0" : null,
			device.parameters.transconductance === undefined ? "Beta" : null,
		].filter((name) => name !== null);
		const part = device.identity.partNumber;
		return `${device.id}${part === null ? "" : ` (${part})`} without ${missing.join("/")}`;
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
function findBjtLawDefaults(netlist: Netlist): readonly BjtLawDefaultWarning[] {
	const defaulted = netlist.devices.filter(
		(device) =>
			device.kind === "bjt" &&
			(device.parameters.saturationCurrent === undefined ||
				device.parameters.beta === undefined),
	);
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((device) => {
		const missing = [
			device.parameters.saturationCurrent === undefined ? "IS" : null,
			device.parameters.beta === undefined ? "BF" : null,
		].filter((name) => name !== null);
		const part = device.identity.partNumber;
		return `${device.id}${part === null ? "" : ` (${part})`} without ${missing.join("/")}`;
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

/** Op-amps that state no output-swing drop. See `OpampLawDefaultWarning`. */
function findOpampLawDefaults(lawed: LawedNetlist): readonly OpampLawDefaultWarning[] {
	const byId = new Map(lawed.netlist.devices.map((device) => [device.id, device]));
	const stated = new Map<string, boolean>();
	for (const resolution of lawed.resolutions) {
		if (resolution.outcome !== "law" || resolution.law.kind !== "ideal-opamp") continue;
		// A section of a package is lowered as `<device>#<index>`; the warning names the device.
		const id = resolution.device.replace(/#\d+$/, "");
		stated.set(id, (stated.get(id) ?? true) && resolution.law.outputSwingDropVolts !== undefined);
	}
	const defaulted = [...stated].flatMap(([id, has]) => (has ? [] : [id]));
	if (defaulted.length === 0) return [];
	const listed = defaulted.map((id) => {
		const part = byId.get(id)?.identity.partNumber ?? null;
		return `${id}${part === null ? "" : ` (${part})`}`;
	});
	return [
		{
			code: "opamp-law-default-parameters" as const,
			device: null,
			devices: defaulted as unknown as OpampLawDefaultWarning["devices"],
			detail:
				`${defaulted.length} op-amp(s) swing the full supply because the part states no ` +
				`output-swing drop: ${listed.join("; ")}. Harmless for a stage that never nears ` +
				"the rails; decisive for a comparator, an LFO or a clipper.",
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
