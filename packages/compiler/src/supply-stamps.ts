// Which compiled `dc-source` stamps are the circuit's external supply.
//
// A compiled Program cannot tell its external rail from its derived ones: the
// compiler ignores power domains, so klon-centaur's +9, +18 and -9 all lower to
// plain `dc-source` stamps. A battery profile must be applied to the external
// rail only, otherwise one cell is counted three times. The document model
// declares which rail is external in typed fields (`CircuitPowerDomain` /
// `CircuitPowerRailBinding`: `sourceKind`, `role`, `derivation`,
// `railComponentId`, `nominalVoltage`), and this module joins that declaration
// to the compiled stamps.
//
// Typed evidence only. This module never reads component names, designators,
// descriptions, or any other prose: a rail is its `railComponentId`, a source
// is its lowered device kind, and a stamp is its terminal rows. Renaming every
// component in the document without touching the typed linkage returns the
// same resolution.
//
// Two joins, both through the compiler's own lowering rather than geometry:
//
// 1. Source kind. Most real packets predate `sourceKind`, so when it is
//    absent the domain's `sourceComponentIds` are classified by the same typed
//    discriminator the device laws use (`device-laws.ts`): a `voltage-source`
//    device with a positive finite `frequency` parameter lowers to `ac-source`
//    and everything else in that kind lowers to `dc-source`; a `rail` with a
//    finite `volts` parameter lowers to `voltage-source` and without one stays
//    `open`; a `transformer` is mains-side magnetics. Any mains evidence makes
//    the domain mains: a boundary touching the wall socket is mains-fed even
//    when it also names DC rails downstream of its rectifier. An explicit
//    `sourceKind` still wins, and a clean contradiction between it and the
//    lowered evidence is its own refusal rather than a silent override.
// 2. Rail to stamp. The rail's device is read from the compiler netlist
//    (`readNetlist`, the same stage `compile` runs first, so declared `node:`
//    keys and the `nodes:` ledger resolve exactly as they did at compile
//    time), and its nodes are matched to `dc-source` stamps through
//    `block.nodeIds`, which translates a stamp's row back to its source node
//    (`lower.ts` builds `nodeIds` as row -> source `NodeId`). Either terminal
//    may identify the rail -- a battery-style supply hangs it off one end or
//    the other depending on grounding, while a single-ended `rail` asserts
//    its potential on the positive terminal with the sign in its volts --
//    except ground on the negative side: node 0 is the common return every
//    supply shares, so it can never name a rail.
// 3. Rail labels with no device. A port or label rail lowers to no device, so
//    its own nodes cannot name a stamp -- but the domain's `sourceComponentIds`
//    say which components feed it, and the stamp is the `dc-source` those
//    sources lower to, read from the program through `block.nodeIds` exactly
//    as in join 2. Only sources with DC evidence (the device-laws
//    discriminator: a `voltage-source` without a positive finite `frequency`,
//    a `rail` with a finite `volts`) contribute; a jack, an `ac-source`, a
//    transformer, or an `open` never counts. Exactly one distinct stamp maps
//    the rail (`via: "domain-source"`); zero keeps `no-stamp-for-rail` and
//    more than one is `ambiguous-stamp`. The mains rule still runs first, so
//    none of this can reach a mains-fed domain.
//
// The inputs are the `.vdsp` source text and the program compiled from it (the
// node resolution does not depend on compile jack options, so none are taken).
// Pure: reads both inputs, mutates neither, and leaves the program's stamps
// exactly as compiled. A source text that cannot be read throws exactly as
// `compile` does on the same text.

import {
	parseInterchangeYaml,
	type CircuitDocument,
} from "@vessel-dsp/core";
import { readNetlist } from "./netlist";
import type { Device, Program } from "./types";
import { GROUND } from "./types";

/** Where a supply stamp lives: which block holds it and which source it is. */
export type SupplyAddress = {
	readonly blockIndex: number;
	readonly sourceIndex: number;
};

export type ResolvedSupply = {
	readonly address: SupplyAddress;
	readonly railComponentId: string;
	readonly role: string;
	readonly nominalVolts: number | null;
	/**
	 * How the rail reached its stamp, compared as a whole value.
	 *
	 * `rail-device` is the rail's own lowered device matched to a stamp through
	 * `block.nodeIds`. `domain-source` is the fallback below: the rail is a
	 * label or port with no lowered device, and the stamp is the one the
	 * domain's own source components lower to. A host can show or ignore the
	 * weaker path; both are typed evidence, never names.
	 */
	readonly via: "rail-device" | "domain-source";
};

/**
 * Why a rail was left on its compiled values, compared as whole values.
 *
 * Closed on purpose: callers switch on `reason`, and the prose in `detail` is
 * for a human reading a report, never for a test to match.
 */
export type SupplyRefusalReason =
	| "no-power-section"
	| "mains-ac-source"
	| "unknown-source-kind"
	| "source-kind-conflict"
	| "derived-rail"
	| "rail-not-main-supply"
	| "no-stamp-for-rail"
	| "ambiguous-stamp";

export type RefusedSupply = {
	readonly railComponentId: string | null;
	readonly reason: SupplyRefusalReason;
	readonly detail: string;
};

export type SupplyResolution = {
	readonly supplies: readonly ResolvedSupply[];
	readonly refused: readonly RefusedSupply[];
};

/**
 * What a source component contributes to its domain, read from the lowered
 * device the same way the device laws read it -- never from names or prose.
 */
type SourceEvidence = "dc" | "ac" | "none";

function sourceEvidence(device: Device): SourceEvidence {
	// Mirrors the `voltage-source` law: a positive finite `frequency`
	// parameter is what makes the device an AC source; presence of the
	// parameter, not anything in the packet's prose, is the discriminator.
	if (device.kind === "voltage-source") {
		const frequency = device.parameters.frequency;
		return frequency !== undefined &&
			Number.isFinite(frequency) &&
			frequency > 0
			? "ac"
			: "dc";
	}
	// Mirrors the `rail` law: a rail with a finite declared voltage asserts a
	// potential (a `voltage-source` law); one without stays `open`.
	if (device.kind === "rail") {
		const volts = device.parameters.volts;
		return typeof volts === "number" && Number.isFinite(volts)
			? "dc"
			: "none";
	}
	// Mains-side magnetics: not a `dc-source` stamp, but mains evidence the
	// same way an `ac-source` device is.
	if (device.kind === "transformer") {
		return "ac";
	}
	return "none";
}

/**
 * Join the document's power domains to the program's `dc-source` stamps.
 *
 * Only rails in an `external-dc` domain -- declared, or inferred from the
 * domain's source components when `sourceKind` is absent -- whose
 * `derivation` is `direct` and whose `role` is `main-supply` are candidates.
 * Each candidate's `railComponentId` resolves to its lowered device, whose
 * nodes are matched to the single `dc-source` stamp with a terminal on one
 * of them. Zero or several such stamps is a refusal naming the rail, never
 * a guess.
 */
export function resolveSupplyStamps(
	source: string,
	program: Program,
): SupplyResolution {
	const document: CircuitDocument = parseInterchangeYaml(source);
	const netlist = readNetlist(source);
	const deviceById = new Map(
		netlist.devices.map((device) => [device.id, device] as const),
	);
	const componentById = new Map(
		document.components.map((component) => [component.id, component] as const),
	);

	const power = document.power;
	if (power === undefined || power.domains.length === 0) {
		return {
			supplies: [],
			refused: [
				{
					railComponentId: null,
					reason: "no-power-section",
					detail:
						"document declares no power section, so no rail can be shown external: every compiled supply keeps its compiled volts and sourceOhms.",
				},
			],
		};
	}

	const supplies: ResolvedSupply[] = [];
	const refused: RefusedSupply[] = [];

	for (const domain of power.domains) {
		const evidence = domain.sourceComponentIds.map(
			(id) => sourceEvidenceOf(deviceById.get(id)),
		);
		const dc = evidence.filter((kind) => kind === "dc").length;
		const ac = evidence.filter((kind) => kind === "ac").length;
		// Any mains evidence makes the domain mains: a boundary touching the
		// wall socket is mains-fed even when it also names DC rails downstream
		// of its rectifier (the amp B+ case). Pure DC evidence is external.
		const inferred =
			ac > 0
				? ("mains-ac" as const)
				: dc > 0
					? ("external-dc" as const)
					: undefined;
		const explicit = domain.sourceKind;
		if (explicit !== undefined && inferred !== undefined && explicit !== inferred) {
			if (domain.rails.length === 0) {
				refused.push({
					railComponentId: null,
					reason: "source-kind-conflict",
					detail: `domain "${domain.id}" declares sourceKind "${explicit}" but its source components lower as ${inferred === "mains-ac" ? "mains" : "external DC"}, so nothing in it can be trusted as external: it keeps its compiled values.`,
				});
			}
			for (const rail of domain.rails) {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "source-kind-conflict",
					detail: `domain "${domain.id}" declares sourceKind "${explicit}" but its source components lower as ${inferred === "mains-ac" ? "mains" : "external DC"}: rail "${rail.railComponentId}" keeps its compiled values.`,
				});
			}
			continue;
		}
		const effective = explicit ?? inferred;
		if (effective === "mains-ac") {
			if (domain.rails.length === 0) {
				refused.push({
					railComponentId: null,
					reason: "mains-ac-source",
					detail: `domain "${domain.id}" is a mains-ac inlet with no declared rails: rectifier behavior is out of scope, so nothing is mapped.`,
				});
			}
			for (const rail of domain.rails) {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "mains-ac-source",
					detail: `domain "${domain.id}" is a mains-ac inlet, so rail "${rail.railComponentId}" is refused: rectifier behavior is out of scope and it keeps its compiled values.`,
				});
			}
			continue;
		}
		if (effective === undefined) {
			if (domain.rails.length === 0) {
				refused.push({
					railComponentId: null,
					reason: "unknown-source-kind",
					detail: `domain "${domain.id}" declares no sourceKind and its source components show no external DC or mains evidence, so nothing can be shown external.`,
				});
			}
			for (const rail of domain.rails) {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "unknown-source-kind",
					detail: `domain "${domain.id}" declares no sourceKind and its source components show no external DC or mains evidence, so rail "${rail.railComponentId}" cannot be shown external or derived: it keeps its compiled values.`,
				});
			}
			continue;
		}
		for (const rail of domain.rails) {
			if (rail.derivation !== "direct") {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "derived-rail",
					detail: `rail "${rail.railComponentId}" is a converter output (derivation "${rail.derivation}"), not a battery terminal: it keeps its compiled values.`,
				});
				continue;
			}
			if (rail.role !== "main-supply") {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "rail-not-main-supply",
					detail: `rail "${rail.railComponentId}" is a direct rail with role "${rail.role}", not the external main supply: it keeps its compiled values.`,
				});
				continue;
			}
			const device = deviceById.get(rail.railComponentId);
			if (device === undefined) {
				// A rail binding that names a component the document does not contain is a
				// defect in the power declaration (a typo, a deleted part). The fallback below
				// reads the domain's sources, so applying it here would silently repair the
				// typo and hide it: refuse by name instead.
				if (!componentById.has(rail.railComponentId)) {
					refused.push({
						railComponentId: rail.railComponentId,
						reason: "no-stamp-for-rail",
						detail: `rail "${rail.railComponentId}" names a component the document does not contain, so no node can be resolved for it and nothing is mapped.`,
					});
					continue;
				}
				// Fallback: the rail is a label or port with no lowered device, so
				// its own nodes cannot name a stamp. The domain's
				// `sourceComponentIds` say which components feed it, and the stamp
				// is the `dc-source` those sources lower to -- read from the
				// program's lowered stamps through `block.nodeIds`, never from
				// the components' kinds or names. A source that lowers to
				// anything else (a jack, an `ac-source`, a transformer, an
				// `open`) never counts. Zero such stamps keeps
				// `no-stamp-for-rail`; more than one distinct stamp is
				// `ambiguous-stamp`, never a pick.
				const sourced = matchDomainSourceStamps(
					domain.sourceComponentIds,
					deviceById,
					program,
				);
				if (sourced.length === 1) {
					const address = sourced[0] as SupplyAddress;
					supplies.push({
						address,
						railComponentId: rail.railComponentId,
						role: rail.role,
						nominalVolts:
							rail.nominalVoltage?.value ?? domain.ratedVoltage?.value ?? null,
						via: "domain-source",
					});
					continue;
				}
				if (sourced.length > 1) {
					const at = sourced
						.map((match) => `block ${match.blockIndex} source ${match.sourceIndex}`)
						.join("; ");
					refused.push({
						railComponentId: rail.railComponentId,
						reason: "ambiguous-stamp",
						detail: `rail "${rail.railComponentId}" has no lowered device, and its domain's sources lower to ${sourced.length} dc-source stamps (${at}), so no single external supply can be named and nothing is mapped.`,
					});
					continue;
				}
				const component = componentById.get(rail.railComponentId);
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "no-stamp-for-rail",
					detail:
						component === undefined
							? `rail "${rail.railComponentId}" names a component the document does not contain, so no node can be resolved for it and nothing is mapped.`
							: `rail "${rail.railComponentId}" is a ${component.kind} symbol with no lowered device, so no stamp can carry it and nothing is mapped.`,
				});
				continue;
			}
			const matches = matchStamps(new Set<number>(device.nodes), program);
			if (matches.length === 1) {
				const address = matches[0] as SupplyAddress;
				supplies.push({
					address,
					railComponentId: rail.railComponentId,
					role: rail.role,
					nominalVolts:
						rail.nominalVoltage?.value ?? domain.ratedVoltage?.value ?? null,
					via: "rail-device",
				});
			} else if (matches.length === 0) {
				const railNodes = new Set<number>(device.nodes);
				const nodes =
					railNodes.size === 0
						? "no resolvable node"
						: `node${railNodes.size === 1 ? "" : "s"} ${[...railNodes].sort((a, b) => a - b).join(", ")}`;
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "no-stamp-for-rail",
					detail: `rail "${rail.railComponentId}" sits on ${nodes}, which carries no dc-source stamp: it keeps its compiled values.`,
				});
			} else {
				const at = matches
					.map((match) => `block ${match.blockIndex} source ${match.sourceIndex}`)
					.join("; ");
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "ambiguous-stamp",
					detail: `rail "${rail.railComponentId}" matches ${matches.length} dc-source stamps (${at}), so no single external supply can be named and nothing is mapped.`,
				});
			}
		}
	}

	return { supplies, refused };
}

function sourceEvidenceOf(device: Device | undefined): SourceEvidence {
	return device === undefined ? "none" : sourceEvidence(device);
}

/**
 * Every `dc-source` stamp with a terminal on one of `nodes`, in
 * `program.blocks` order then stamp order.
 *
 * Either terminal may identify the rail: a battery-style supply hangs it off
 * one end or the other depending on grounding, while a single-ended `rail`
 * asserts its potential on the positive terminal with the sign in its volts
 * (the germanium positive-ground case). Ground on the negative side never
 * counts: node 0 is the common return every supply shares, so it cannot name
 * a rail.
 */
function matchStamps(nodes: Set<number>, program: Program): SupplyAddress[] {
	const matches: SupplyAddress[] = [];
	program.blocks.forEach((block, blockIndex) => {
		if (block.kind !== "mna") {
			return;
		}
		for (const stamp of block.stamps) {
			if (stamp.kind !== "dc-source") {
				continue;
			}
			const positiveNode: number | undefined = block.nodeIds[stamp.positive];
			const negativeNode: number | undefined = block.nodeIds[stamp.negative];
			const touches =
				(positiveNode !== undefined && nodes.has(positiveNode)) ||
				(negativeNode !== undefined &&
					negativeNode !== GROUND &&
					nodes.has(negativeNode));
			if (touches) {
				matches.push({ blockIndex, sourceIndex: stamp.sourceIndex });
			}
		}
	});
	return matches;
}

/**
 * The distinct `dc-source` stamps the domain's source components lower to.
 *
 * Only sources that exist as netlist devices and carry DC evidence -- the
 * same discriminator the device laws use, so a jack, an `ac-source`, a
 * transformer, or an `open` never counts -- contribute their nodes; the stamp
 * itself comes from the program's lowered result, never from a component's
 * kind string or name. Two sources sharing one stamp still name one supply;
 * two sources on two stamps is genuinely ambiguous.
 */
function matchDomainSourceStamps(
	sourceComponentIds: readonly string[],
	deviceById: Map<string, Device>,
	program: Program,
): SupplyAddress[] {
	const seen = new Set<string>();
	const out: SupplyAddress[] = [];
	for (const id of sourceComponentIds) {
		const device = deviceById.get(id);
		if (device === undefined) {
			continue;
		}
		if (sourceEvidence(device) !== "dc") {
			continue;
		}
		for (const match of matchStamps(new Set<number>(device.nodes), program)) {
			const key = `${match.blockIndex}:${match.sourceIndex}`;
			if (!seen.has(key)) {
				seen.add(key);
				out.push(match);
			}
		}
	}
	return out;
}
