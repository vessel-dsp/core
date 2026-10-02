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
// descriptions, or any other prose: a rail is its `railComponentId`, a node is
// the connectivity pin map, and a stamp is its terminal rows. Renaming every
// component in the document without touching the typed linkage returns the
// same resolution.
//
// Connectivity note. `CircuitDocument` carries no declared `node:` ledger --
// the interchange parser drops it and `Terminal` has no node field -- so the
// document side is read with `resolveConnectivity`, the same geometric
// resolver the compiler falls back to when a document declares no nodes. For a
// document whose connectivity is purely geometric, core's ids and the
// compiler's internal ids agree (ground is 0, the rest follow document order),
// and `block.nodeIds` translates a stamp's row back to exactly such an id
// (`lower.ts` builds `nodeIds` as row -> source `NodeId`). A document that
// relies solely on a declared ledger with no matching geometry will resolve to
// `no-stamp-for-rail` rather than to a guessed stamp: refusing is the honest
// answer when the evidence is not in view.

import {
	getPinNode,
	resolveConnectivity,
	type CircuitDocument,
} from "@vessel-dsp/core";
import type { Program } from "./types";

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
 * Join the document's power domains to the program's `dc-source` stamps.
 *
 * Only rails in an `external-dc` domain whose `derivation` is `direct` and
 * whose `role` is `main-supply` are candidates. Each candidate's
 * `railComponentId` resolves through the document connectivity to the node its
 * terminals sit on; the supply is the single `dc-source` stamp whose
 * supply-side terminal is that node -- the positive terminal, or the negative
 * terminal for a `positive-ground` domain, where the rail runs below ground.
 * Zero or several such stamps is a refusal naming the rail, never a guess.
 *
 * Pure: reads both inputs, mutates neither, and leaves the program's stamps
 * exactly as compiled.
 */
export function resolveSupplyStamps(
	document: CircuitDocument,
	program: Program,
): SupplyResolution {
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

	const connectivity = resolveConnectivity(document);
	const componentById = new Map(
		document.components.map((component) => [component.id, component] as const),
	);

	const supplies: ResolvedSupply[] = [];
	const refused: RefusedSupply[] = [];

	for (const domain of power.domains) {
		if (domain.sourceKind === "mains-ac") {
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
		if (domain.sourceKind === undefined) {
			if (domain.rails.length === 0) {
				refused.push({
					railComponentId: null,
					reason: "unknown-source-kind",
					detail: `domain "${domain.id}" declares no sourceKind and no rails, so nothing can be shown external.`,
				});
			}
			for (const rail of domain.rails) {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "unknown-source-kind",
					detail: `domain "${domain.id}" declares no sourceKind, so rail "${rail.railComponentId}" cannot be shown external or derived: it keeps its compiled values.`,
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
			const component = componentById.get(rail.railComponentId);
			if (component === undefined) {
				refused.push({
					railComponentId: rail.railComponentId,
					reason: "no-stamp-for-rail",
					detail: `rail "${rail.railComponentId}" names a component the document does not contain, so no node can be resolved for it and nothing is mapped.`,
				});
				continue;
			}
			const railNodes = new Set<number>();
			for (const terminal of component.terminals) {
				const node = getPinNode(connectivity, {
					componentId: component.id,
					terminalName: terminal.name,
				});
				if (node !== undefined) {
					railNodes.add(node);
				}
			}
			// A positive-ground supply runs its rail below ground: the rail is the
			// stamp's negative terminal. Every other polarity hangs the rail off
			// the positive terminal, including bipolar, whose main supply is the
			// positive rail of the pair.
			const positiveGround = domain.groundPolarity === "positive-ground";
			const matches: SupplyAddress[] = [];
			program.blocks.forEach((block, blockIndex) => {
				if (block.kind !== "mna") {
					return;
				}
				for (const stamp of block.stamps) {
					if (stamp.kind !== "dc-source") {
						continue;
					}
					const row = positiveGround ? stamp.negative : stamp.positive;
					const sourceNode: number | undefined = block.nodeIds[row];
					if (sourceNode !== undefined && railNodes.has(sourceNode)) {
						matches.push({ blockIndex, sourceIndex: stamp.sourceIndex });
					}
				}
			});
			if (matches.length === 1) {
				const address = matches[0] as SupplyAddress;
				supplies.push({
					address,
					railComponentId: rail.railComponentId,
					role: rail.role,
					nominalVolts:
						rail.nominalVoltage?.value ?? domain.ratedVoltage?.value ?? null,
				});
			} else if (matches.length === 0) {
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
