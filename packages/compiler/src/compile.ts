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
import { emptyRegistry, foldPartId, registryLawFor, type PartEntry, type PartRegistry } from "./registry";
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
	OpampGainBandwidthDefaultWarning,
	OpampLawDefaultItem,
	OpampLawDefaultWarning,
	CompileResult,
	DeclaredDelayWarning,
	DeviceId,
	FetLawDefaultWarning,
	LawedNetlist,
	ModulationNotModelledWarning,
	Netlist,
	NodeId,
	Program,
	RailWithoutVoltageWarning,
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
		...findBjtLawDefaults(netlist),
		...findRegistryProvisionalValues(netlist, lawed, options.registry ?? emptyRegistry),
		...findOpampLawDefaults(lawed),
		...findOpampGainBandwidthDefaults(lawed),
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
function findFetLawDefaults(
	netlist: Netlist,
	registry: PartRegistry,
): readonly FetLawDefaultWarning[] {
	const defaulted = netlist.devices.filter(
		(device) =>
			device.kind === "jfet" &&
			(device.parameters.thresholdVolts === undefined ||
				device.parameters.transconductance === undefined) &&
			// A registered part runs on its catalog entry, not the class default --
			// naming it here would claim the opposite. Exact part id only, the same
			// rung `device-laws.ts` refines on.
			registryLawFor(registry, device.identity.partNumber, "fet") === null,
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
		if (resolution.outcome !== "law" || resolution.law.kind !== "ideal-opamp") continue;
		// A section of a package is lowered as `<device>#<index>`; the warning names the device.
		const id = resolution.device.replace(/#\d+$/, "");
		const law = resolution.law;
		const section = judged.get(id) ?? { stated: true, carried: null };
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
		if (law.kind !== "ideal-opamp" && law.kind !== "compandor") continue;
		if (law.kind === "ideal-opamp" && law.gainBandwidthHz !== undefined) continue;
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
