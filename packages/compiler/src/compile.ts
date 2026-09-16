// The pipeline: `.vdsp` source text -> a program, or an explanation of the refusal.
//
// Seven stages, composed. The registry is a parameter rather than an import, so the
// compiler holds no knowledge of any specific part -- and compiling with an empty
// registry is a legitimate configuration that measures what works with no part
// knowledge at all.

import {
	attachDeviceLaws,
	findElectricallyIsolatedIcs,
	findIcsNotExecuted,
	findUnimplementedDeviceLaws,
} from "./device-laws";
import {
	findMultiDeviceShells,
	findUnreadableTerminalRoles,
} from "./unreadable-terminal-role";
import { findUnexecutedRegions } from "./unexecuted-region";
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
import type {
	CompileResult,
	DeclaredDelayWarning,
	LawedNetlist,
	ModulationNotModelledWarning,
	Program,
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
	const linked: Program = link(
		coupled.blocks,
		{ ...partitioning, dependencies: coupled.dependencies },
		netlist.controls,
		netlist.ports,
		netlist.portImpedanceOhms,
		netlist.portDeclaredFullScaleVolts,
	);
	// Stage 6.5: an op-amp the topology leaves genuinely undefined (no DC path back to its
	// inverting input, or none from its non-inverting input to any reference) gets an implicit
	// bias so its operating point is bounded rather than left to whatever `gmin` alone settles
	// into -- see `dangling-active-terminal.ts`'s "implicit op-amp DC-bias synthesis" section.
	// Every later Program-consuming stage below reads the bridged program, because that is the
	// one the runtime will actually execute.
	const program: Program = synthesizeOpampImplicitBias(linked);
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
				device: (w.devices && w.devices.length > 0) ? (w.devices[0] ?? null) : null,
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
			...findIcsNotExecuted(lawed, netlist),
			...findUnreadableTerminalRoles(lawed),
			...findMultiDeviceShells(lawed),
			...findUnimplementedDeviceLaws(lawed),
			...findUnreachableOutput(program, netlist),
			...findUnexecutedRegions(program),
			...findDeclaredDelays(program),
			...findUnmodelledModulation(program),
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
		block.kind === "macro" && typeof block.modulationRefusal === "string"
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
		block.kind === "macro" && block.delayProvenance === "declared"
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
