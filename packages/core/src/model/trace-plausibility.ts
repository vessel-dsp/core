/**
 * trace-plausibility.ts — advisory `.vdsp` trace checks.
 *
 * Cheap, static heuristics that flag *suspicious* traces for a human/agent to
 * double-check against the source. Every issue is severity `"warning"`. This is
 * NOT a verifier and NOT a rating input, and it is deliberately incomplete.
 * Simple value/corner checks cannot catch a plausible `1n`->`1u` slip, but the
 * opt-in audio-topology pass can warn when surrounding graph context makes the
 * resulting shunt destructive. Dynamic admission is still required for
 * behavioral validation.
 *
 * Structure vs value are split on purpose:
 *  - `validateTraceStructure` — connectivity-dependent (floating/shorted/divider).
 *    It is COVERAGE-GATED and fails closed: if the resolved net graph is not
 *    sufficiently complete, it emits a single `trace-connectivity-incomplete`
 *    note and runs NO net checks (rather than emitting hundreds of artifacts).
 *  - `validatePreferredValues` — connectivity-independent E24 check. Noisy
 *    (vintage/E48/E96 values, tolerances), so it is OPT-IN, not in the default.
 *  - `validateRcCornerHeuristic` — a rough RC-corner heuristic, OPT-IN only; it
 *    has a high intrinsic false-positive rate (intentional sub-/supersonic poles)
 *    and does NOT catch in-band value slips, so it is not a default check.
 *  - `validateAudioTopologyWarnings` — OPT-IN, role- and connectivity-gated
 *    warnings for destructive audio shunts, extreme direct input loading, and
 *    explicitly declared op-amp buffers without a passive feedback path.
 *
 * `validateTracePlausibility` runs the safe default (structure only) plus any
 * opt-in checks requested via options.
 */
import {
	type Connectivity,
	getPinNode,
	type NodeId,
	resolveConnectivity,
} from "./connectivity";
import { propertyQuantityValue, propertyStringValue } from "./properties";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	PropertyValue,
} from "./types";
import type { ValidationIssue } from "./validation";

export type TracePlausibilityOptions = Readonly<{
	/** Inject a resolved net graph (e.g. from declared nodes). Falls back to geometric resolveConnectivity(doc). */
	connectivity?: Connectivity;
	/** Min fraction of terminals that must sit on a ≥2-member net before net checks run (default 0.9). Below this, net checks fail closed. */
	requiredCompleteness?: number;
	/** Divider legs whose ratio exceeds this are flagged (default 50). */
	dividerRatio?: number;
	/** Opt-in: run the noisy E24 preferred-value check (default false). */
	includePreferredValue?: boolean;
	/** Opt-in: run the rough RC-corner heuristic (default false). */
	includeRcCorner?: boolean;
	/** Opt-in: run role-aware audio topology warning checks (default false). */
	includeAudioTopology?: boolean;
	/** Source-declared node roles used by audio topology checks. */
	nodeRoles?: ReadonlyMap<NodeId, string>;
	/** RC band for the opt-in heuristic, Hz (default extreme-only [0.2, 120000]). */
	audioBand?: readonly [number, number];
}>;

const E24 = [
	1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7,
	5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];
const SUPPLY_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"voltage-source",
	"current-source",
	"battery",
	"rail",
	"ground",
	"regulator",
	"power-converter",
]);
// A lone terminal is a real "broken trace" signal only for 2-terminal passives.
// Unused/NC pins on ICs, op-amps, transistors, jacks, etc. are expected.
const FLOAT_FLAG_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"resistor",
	"capacitor",
	"inductor",
	"diode",
	"led",
	"variable-resistor",
]);
const AUDIO_INPUT_ROLES = new Set(["input", "audio-input", "in"]);
const AUDIO_OUTPUT_ROLES = new Set(["output", "audio-output", "out"]);
const AUDIO_REFERENCE_ROLES = new Set(["bias", "bias-reference", "reference"]);
const SUPPLY_NODE_ROLES = new Set([
	"main-supply",
	"negative-supply",
	"regulated-output",
	"charge-pump-output",
	"power",
	"power-input",
	"rail",
	"supply",
]);
const PASSIVE_PATH_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"resistor",
	"capacitor",
	"inductor",
	"diode",
	"switch",
	"variable-resistor",
	"potentiometer",
]);
const AUDIO_SHUNT_REFERENCE_HZ = 1000;
const AUDIO_SHUNT_WARNING_DB = -12;
const INPUT_LOADING_WARNING_OHMS = 2000;

function readSiValue(prop: PropertyValue | undefined): number | null {
	const q = propertyQuantityValue(prop);
	if (q && Number.isFinite(q.value)) return q.value;
	if (typeof prop === "string") {
		const m = prop.match(/value:\s*(-?[0-9.]+(?:e-?[0-9]+)?)/i);
		if (m) {
			const n = Number(m[1]);
			if (Number.isFinite(n)) return n;
		}
	}
	return null;
}

function componentValue(c: Component): number | null {
	if (c.kind === "resistor" || c.kind === "variable-resistor")
		return readSiValue(c.properties?.Resistance);
	if (c.kind === "capacitor") return readSiValue(c.properties?.Capacitance);
	return null;
}

// Robust decade normalization (avoids float drift from iterative *10).
function mantissa(v: number): number {
	if (!(v > 0)) return Number.NaN;
	return v / 10 ** Math.floor(Math.log10(v));
}
function isE24(v: number): boolean {
	const m = mantissa(v);
	if (!Number.isFinite(m)) return false;
	// treat ~10 (float edge) as the next decade's 1.0
	const mm = m >= 9.95 ? 1 : m;
	return E24.some((e) => Math.abs(e - mm) / e < 0.02);
}

function fmt(v: number): string {
	const a = Math.abs(v);
	if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
	if (a >= 1e3) return `${+(v / 1e3).toPrecision(3)}k`;
	if (a >= 1) return `${+v.toPrecision(3)}`;
	if (a >= 1e-3) return `${+(v * 1e3).toPrecision(3)}m`;
	if (a >= 1e-6) return `${+(v * 1e6).toPrecision(3)}u`;
	if (a >= 1e-9) return `${+(v * 1e9).toPrecision(3)}n`;
	return `${+(v * 1e12).toPrecision(3)}p`;
}

function nodesOf(conn: Connectivity, c: Component): number[] {
	const out: number[] = [];
	for (const t of c.terminals ?? []) {
		const n = getPinNode(conn, { componentId: c.id, terminalName: t.name });
		if (n !== undefined) out.push(n);
	}
	return out;
}

function uniqueNodesOf(conn: Connectivity, component: Component): NodeId[] {
	return [...new Set(nodesOf(conn, component))];
}

function normalizedRole(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, "-");
}

function propertyText(component: Component, ...names: string[]): string | null {
	const wanted = new Set(names.map((name) => name.toLowerCase()));
	for (const [name, value] of Object.entries(component.properties ?? {})) {
		if (!wanted.has(name.toLowerCase())) continue;
		const text = propertyStringValue(value);
		if (text?.trim()) return text.trim();
	}
	return null;
}

function componentRole(doc: CircuitDocument, component: Component): string {
	const direct = propertyText(component, "Role", "AudioRole", "BoundaryRole");
	if (direct) return normalizedRole(direct);
	const control = doc.deviceInterface?.controls.find(
		(item) =>
			item.id === component.id || item.binding?.componentId === component.id,
	);
	return control ? normalizedRole(control.role) : "";
}

function terminalNode(
	conn: Connectivity,
	component: Component,
	aliases: readonly string[],
): NodeId | undefined {
	const wanted = new Set(
		aliases.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")),
	);
	for (const terminal of component.terminals) {
		const name = terminal.name.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (!wanted.has(name)) continue;
		const node = getPinNode(conn, {
			componentId: component.id,
			terminalName: terminal.name,
		});
		if (node !== undefined) return node;
	}
	return undefined;
}

function jackSignalNode(
	conn: Connectivity,
	component: Component,
): NodeId | undefined {
	return terminalNode(conn, component, [
		"tip",
		"signal",
		"anode",
		"positive",
		"t",
	]);
}

type AudioPorts = Readonly<{
	inputs: readonly Component[];
	outputs: readonly Component[];
}>;

function audioPorts(doc: CircuitDocument): AudioPorts {
	const inputs: Component[] = [];
	const outputs: Component[] = [];
	for (const component of doc.components) {
		if (component.kind !== "jack") continue;
		const role = componentRole(doc, component);
		if (AUDIO_INPUT_ROLES.has(role)) inputs.push(component);
		if (AUDIO_OUTPUT_ROLES.has(role)) outputs.push(component);
	}
	return { inputs, outputs };
}

type AudioNodeSets = Readonly<{
	ground: ReadonlySet<NodeId>;
	audioReferences: ReadonlySet<NodeId>;
	supplies: ReadonlySet<NodeId>;
	blocked: ReadonlySet<NodeId>;
}>;

function addRoleNode(
	roleValue: string,
	nodeId: NodeId,
	ground: Set<NodeId>,
	audioReferences: Set<NodeId>,
	supplies: Set<NodeId>,
): void {
	const role = normalizedRole(roleValue);
	if (role === "ground") ground.add(nodeId);
	if (AUDIO_REFERENCE_ROLES.has(role)) audioReferences.add(nodeId);
	if (SUPPLY_NODE_ROLES.has(role)) supplies.add(nodeId);
}

function componentBetweenNodes(
	doc: CircuitDocument,
	conn: Connectivity,
	kind: ComponentKind,
	node: NodeId,
	targets: ReadonlySet<NodeId>,
): Component | undefined {
	return doc.components.find((component) => {
		if (component.kind !== kind) return false;
		const nodes = uniqueNodesOf(conn, component);
		return (
			nodes.length === 2 &&
			nodes.includes(node) &&
			nodes.some((candidate) => candidate !== node && targets.has(candidate))
		);
	});
}

function audioNodeSets(
	doc: CircuitDocument,
	conn: Connectivity,
	nodeRoles: ReadonlyMap<NodeId, string> | undefined,
	ports: AudioPorts,
): AudioNodeSets {
	const ground = new Set<NodeId>();
	const audioReferences = new Set<NodeId>();
	const supplies = new Set<NodeId>();
	if (conn.groundNodeId !== null) ground.add(conn.groundNodeId);
	for (const [nodeId, role] of nodeRoles ?? []) {
		addRoleNode(role, nodeId, ground, audioReferences, supplies);
	}

	const powerRailRoles = new Map<string, string>();
	for (const domain of doc.power?.domains ?? []) {
		for (const rail of domain.rails) {
			powerRailRoles.set(rail.railComponentId, rail.role);
		}
	}
	for (const component of doc.components) {
		const nodes = uniqueNodesOf(conn, component);
		if (component.kind === "ground") {
			for (const node of nodes) ground.add(node);
		}
		if (component.kind === "rail") {
			const role = powerRailRoles.get(component.id);
			for (const node of nodes) {
				if (role === "bias-reference") audioReferences.add(node);
				else supplies.add(node);
			}
		}
	}

	if (ports.inputs.length === 1 && ports.outputs.length === 1) {
		const input = ports.inputs[0];
		const output = ports.outputs[0];
		if (input && output) {
			const inputSleeve = terminalNode(conn, input, [
				"sleeve",
				"ground",
				"cathode",
				"negative",
				"return",
			]);
			const outputSleeve = terminalNode(conn, output, [
				"sleeve",
				"ground",
				"cathode",
				"negative",
				"return",
			]);
			if (inputSleeve !== undefined && inputSleeve === outputSleeve) {
				ground.add(inputSleeve);
			}
		}
	}

	for (const nodeId of conn.nodeMembers.keys()) {
		if (ground.has(nodeId) || supplies.has(nodeId)) continue;
		const hasGroundResistor = componentBetweenNodes(
			doc,
			conn,
			"resistor",
			nodeId,
			ground,
		);
		const hasSupplyResistor = componentBetweenNodes(
			doc,
			conn,
			"resistor",
			nodeId,
			supplies,
		);
		const hasGroundCapacitor = componentBetweenNodes(
			doc,
			conn,
			"capacitor",
			nodeId,
			ground,
		);
		if (hasGroundResistor && hasSupplyResistor && hasGroundCapacitor) {
			audioReferences.add(nodeId);
		}
	}

	const blocked = new Set([...ground, ...audioReferences, ...supplies]);
	return { ground, audioReferences, supplies, blocked };
}

type GraphEdge = readonly [NodeId, NodeId, Component];

function passivePathEdges(
	doc: CircuitDocument,
	conn: Connectivity,
	blocked: ReadonlySet<NodeId>,
	excludedComponentId?: string,
): GraphEdge[] {
	const edges: GraphEdge[] = [];
	for (const component of doc.components) {
		if (
			component.id === excludedComponentId ||
			!PASSIVE_PATH_KINDS.has(component.kind)
		) {
			continue;
		}
		const nodes = uniqueNodesOf(conn, component).filter(
			(node) => !blocked.has(node),
		);
		for (let index = 0; index < nodes.length; index += 1) {
			const nodeA = nodes[index];
			if (nodeA === undefined) continue;
			for (const nodeB of nodes.slice(index + 1)) {
				edges.push([nodeA, nodeB, component]);
			}
		}
	}
	return edges;
}

function audioSignalEdges(
	doc: CircuitDocument,
	conn: Connectivity,
	blocked: ReadonlySet<NodeId>,
	excludedComponentId?: string,
): GraphEdge[] {
	const edges = passivePathEdges(doc, conn, blocked, excludedComponentId);
	for (const component of doc.components) {
		if (component.kind !== "opamp") continue;
		const signalNodes = [
			terminalNode(conn, component, ["positive", "plus", "nonInverting"]),
			terminalNode(conn, component, ["negative", "minus", "inverting"]),
			terminalNode(conn, component, ["out", "output"]),
		].filter(
			(node): node is NodeId => node !== undefined && !blocked.has(node),
		);
		for (let index = 0; index < signalNodes.length; index += 1) {
			const nodeA = signalNodes[index];
			if (nodeA === undefined) continue;
			for (const nodeB of signalNodes.slice(index + 1)) {
				edges.push([nodeA, nodeB, component]);
			}
		}
	}
	return edges;
}

function shortestPathNodes(
	start: NodeId | undefined,
	target: NodeId | undefined,
	edges: readonly GraphEdge[],
): NodeId[] | null {
	if (start === undefined || target === undefined) return null;
	if (start === target) return [start];
	const adjacency = new Map<NodeId, Set<NodeId>>();
	for (const [nodeA, nodeB] of edges) {
		if (!adjacency.has(nodeA)) adjacency.set(nodeA, new Set());
		if (!adjacency.has(nodeB)) adjacency.set(nodeB, new Set());
		adjacency.get(nodeA)?.add(nodeB);
		adjacency.get(nodeB)?.add(nodeA);
	}
	const queue: NodeId[] = [start];
	const seen = new Set<NodeId>([start]);
	const previous = new Map<NodeId, NodeId>();
	for (let index = 0; index < queue.length; index += 1) {
		const node = queue[index];
		if (node === undefined) continue;
		for (const neighbor of adjacency.get(node) ?? []) {
			if (seen.has(neighbor)) continue;
			seen.add(neighbor);
			previous.set(neighbor, node);
			if (neighbor === target) {
				const path = [target];
				while (path[0] !== start) {
					const child = path[0];
					if (child === undefined) return null;
					const parent = previous.get(child);
					if (parent === undefined) return null;
					path.unshift(parent);
				}
				return path;
			}
			queue.push(neighbor);
		}
	}
	return null;
}

function reachable(
	start: NodeId | undefined,
	target: NodeId | undefined,
	edges: readonly GraphEdge[],
): boolean {
	return shortestPathNodes(start, target, edges) !== null;
}

/** Fraction of component terminals that sit on a ≥2-member net (connectivity completeness). */
export function traceConnectivityCompleteness(
	doc: CircuitDocument,
	conn: Connectivity,
): { fraction: number; connected: number; total: number } {
	let total = 0;
	let connected = 0;
	for (const c of doc.components) {
		for (const t of c.terminals ?? []) {
			total++;
			const n = getPinNode(conn, { componentId: c.id, terminalName: t.name });
			if (n !== undefined && (conn.nodeMembers.get(n)?.length ?? 0) >= 2)
				connected++;
		}
	}
	return { fraction: total === 0 ? 1 : connected / total, connected, total };
}

function connectivityIncompleteIssue(
	coverage: ReturnType<typeof traceConnectivityCompleteness>,
): ValidationIssue {
	return {
		code: "trace-connectivity-incomplete",
		severity: "warning",
		message: `resolved net graph is only ${(coverage.fraction * 100).toFixed(0)}% complete (${coverage.connected}/${coverage.total} terminals on a >=2-member net); connectivity-dependent trace checks skipped (fail-closed). Provide complete connectivity to enable them.`,
	};
}

/** Connectivity-dependent structural checks. Coverage-gated; fails closed. */
export function validateTraceStructure(
	doc: CircuitDocument,
	options: TracePlausibilityOptions = {},
): readonly ValidationIssue[] {
	const conn = options.connectivity ?? resolveConnectivity(doc);
	const required = options.requiredCompleteness ?? 0.9;
	const dividerRatio = options.dividerRatio ?? 50;
	const issues: ValidationIssue[] = [];
	const byId = new Map<string, Component>(doc.components.map((c) => [c.id, c]));

	const cov = traceConnectivityCompleteness(doc, conn);
	if (cov.fraction < required) {
		return [connectivityIncompleteIssue(cov)];
	}

	const railNodes = new Set<number>();
	if (conn.groundNodeId != null) railNodes.add(conn.groundNodeId);
	for (const [nid, members] of conn.nodeMembers) {
		for (const m of members) {
			const comp = byId.get(m.componentId);
			if (comp && SUPPLY_KINDS.has(comp.kind)) {
				railNodes.add(nid);
				break;
			}
		}
	}

	// 1. floating passive terminal
	for (const [nid, members] of conn.nodeMembers) {
		const only = members[0];
		if (members.length !== 1 || !only || railNodes.has(nid)) continue;
		const comp = byId.get(only.componentId);
		if (!comp || !FLOAT_FLAG_KINDS.has(comp.kind)) continue;
		issues.push({
			code: "trace-floating-node",
			severity: "warning",
			message: `${only.componentId}.${only.terminalName} is the only pin on net #${nid} — floating/unconnected; double-check the trace.`,
			componentId: only.componentId,
		});
	}

	// 2. shorted two-terminal passive
	for (const c of doc.components) {
		if (
			c.kind !== "resistor" &&
			c.kind !== "capacitor" &&
			c.kind !== "inductor"
		)
			continue;
		const ns = nodesOf(conn, c);
		if (ns.length >= 2 && new Set(ns).size === 1) {
			issues.push({
				code: "trace-shorted-part",
				severity: "warning",
				message: `${c.id} (${c.kind}) has both terminals on net #${ns[0]} — shorted; double-check.`,
				componentId: c.id,
			});
		}
	}

	// 3. bias-divider asymmetry
	for (const [nid, members] of conn.nodeMembers) {
		if (railNodes.has(nid)) continue;
		const resIds = [
			...new Set(
				members
					.map((m) => byId.get(m.componentId))
					.filter((c): c is Component => !!c && c.kind === "resistor")
					.map((c) => c.id),
			),
		];
		if (resIds.length !== 2) continue;
		const legs = resIds
			.map((id) => byId.get(id))
			.filter((c): c is Component => c !== undefined);
		const [ra, rb] = legs;
		if (!ra || !rb) continue;
		const railBacked = legs.filter((r) =>
			nodesOf(conn, r).some((n) => n !== nid && railNodes.has(n)),
		);
		if (railBacked.length !== 2) continue;
		const a = componentValue(ra);
		const b = componentValue(rb);
		if (a == null || b == null || a <= 0 || b <= 0) continue;
		const ratio = Math.max(a, b) / Math.min(a, b);
		if (ratio >= dividerRatio) {
			issues.push({
				code: "trace-divider-asymmetry",
				severity: "warning",
				message: `bias-divider legs ${ra.id}=${fmt(a)} and ${rb.id}=${fmt(b)} differ ${Math.round(ratio)}x (net #${nid}) — possible k/M or magnitude slip; double-check.`,
				componentId: ra.id,
			});
		}
	}
	return issues;
}

function findInputLoadingWarnings(
	doc: CircuitDocument,
	conn: Connectivity,
	input: Component,
	nodes: AudioNodeSets,
): ValidationIssue[] {
	const inputNode = jackSignalNode(conn, input);
	if (inputNode === undefined) return [];
	const references = new Set([...nodes.ground, ...nodes.audioReferences]);
	const issues: ValidationIssue[] = [];
	for (const component of doc.components) {
		if (component.kind !== "resistor") continue;
		const value = componentValue(component);
		const componentNodes = uniqueNodesOf(conn, component);
		if (
			value === null ||
			value > INPUT_LOADING_WARNING_OHMS ||
			componentNodes.length !== 2 ||
			!componentNodes.includes(inputNode)
		) {
			continue;
		}
		const otherNode = componentNodes.find((node) => node !== inputNode);
		if (otherNode === undefined || !references.has(otherNode)) continue;
		issues.push({
			code: "trace-input-loading-extreme",
			severity: "warning",
			message: `${component.id} loads audio input ${input.id} with ${fmt(value)} ohm to an AC reference; double-check the value and input trace.`,
			componentId: component.id,
		});
	}
	return issues;
}

function findAudioShuntWarnings(
	doc: CircuitDocument,
	conn: Connectivity,
	input: Component,
	output: Component,
	nodes: AudioNodeSets,
): ValidationIssue[] {
	const inputNode = jackSignalNode(conn, input);
	const outputNode = jackSignalNode(conn, output);
	const issues: ValidationIssue[] = [];
	for (const capacitor of doc.components) {
		if (capacitor.kind !== "capacitor") continue;
		const capacitance = componentValue(capacitor);
		const capacitorNodes = uniqueNodesOf(conn, capacitor);
		if (capacitance === null || capacitorNodes.length !== 2) continue;
		const [nodeA, nodeB] = capacitorNodes;
		if (nodeA === undefined || nodeB === undefined) continue;
		const aIsReference =
			nodes.ground.has(nodeA) || nodes.audioReferences.has(nodeA);
		const bIsReference =
			nodes.ground.has(nodeB) || nodes.audioReferences.has(nodeB);
		if (aIsReference === bIsReference) continue;
		const signalNode = aIsReference ? nodeB : nodeA;
		if (nodes.supplies.has(signalNode)) continue;
		const path = shortestPathNodes(
			inputNode,
			outputNode,
			audioSignalEdges(doc, conn, nodes.blocked, capacitor.id),
		);
		if (!path?.includes(signalNode)) continue;

		const adjacent = doc.components.filter((component) => {
			if (component.kind !== "resistor" || componentValue(component) === null) {
				return false;
			}
			const resistorNodes = uniqueNodesOf(conn, component);
			return (
				resistorNodes.length === 2 &&
				resistorNodes.includes(signalNode) &&
				resistorNodes.every(
					(node) => node === signalNode || !nodes.blocked.has(node),
				)
			);
		});
		const resistor = adjacent.sort(
			(a, b) =>
				(componentValue(a) ?? Infinity) - (componentValue(b) ?? Infinity),
		)[0];
		if (!resistor) continue;
		const resistance = componentValue(resistor);
		if (resistance === null) continue;
		const cornerHz = 1 / (2 * Math.PI * resistance * capacitance);
		const attenuation =
			1 / Math.sqrt(1 + (AUDIO_SHUNT_REFERENCE_HZ / cornerHz) ** 2);
		const attenuationDb = 20 * Math.log10(attenuation);
		if (attenuationDb > AUDIO_SHUNT_WARNING_DB) continue;
		issues.push({
			code: "trace-audio-shunt-extreme",
			severity: "warning",
			message: `if declared connectivity is correct, ${resistor.id} and ${capacitor.id} form an audio-path shunt with ~${cornerHz.toFixed(1)} Hz low-pass corner and ${attenuationDb.toFixed(1)} dB at 1 kHz; double-check the node assignment and both values.`,
			componentId: capacitor.id,
		});
	}
	return issues;
}

function findOpampFeedbackWarnings(
	doc: CircuitDocument,
	conn: Connectivity,
	input: Component,
	output: Component,
	nodes: AudioNodeSets,
): ValidationIssue[] {
	const inputNode = jackSignalNode(conn, input);
	const outputNode = jackSignalNode(conn, output);
	const edges = passivePathEdges(doc, conn, nodes.blocked);
	const issues: ValidationIssue[] = [];
	for (const component of doc.components) {
		if (
			component.kind !== "opamp" ||
			!componentRole(doc, component).includes("buffer")
		) {
			continue;
		}
		const plus = terminalNode(conn, component, [
			"positive",
			"plus",
			"nonInverting",
		]);
		const minus = terminalNode(conn, component, [
			"negative",
			"minus",
			"inverting",
		]);
		const out = terminalNode(conn, component, ["out", "output"]);
		if (
			!reachable(inputNode, plus, edges) ||
			!reachable(out, outputNode, edges) ||
			out === undefined ||
			minus === undefined ||
			out === minus ||
			reachable(out, minus, edges)
		) {
			continue;
		}
		issues.push({
			code: "trace-opamp-feedback-open",
			severity: "warning",
			message: `${component.id} is declared as an audio buffer on the input/output path but has no passive negative-feedback path from output to inverting input; double-check its pins and feedback trace.`,
			componentId: component.id,
		});
	}
	return issues;
}

/** Role-aware audio warnings. Locally coverage-gated and opt-in from the aggregate API. */
export function validateAudioTopologyWarnings(
	doc: CircuitDocument,
	options: TracePlausibilityOptions = {},
): readonly ValidationIssue[] {
	const conn = options.connectivity ?? resolveConnectivity(doc);
	const ports = audioPorts(doc);
	if (ports.inputs.length !== 1 || ports.outputs.length !== 1) {
		return [
			{
				code: "trace-audio-role-ambiguous",
				severity: "warning",
				message: `audio topology checks skipped: expected exactly one audio input and one audio output, found ${ports.inputs.length} input(s) and ${ports.outputs.length} output(s).`,
			},
		];
	}
	const input = ports.inputs[0];
	const output = ports.outputs[0];
	if (!input || !output) return [];
	const inputNode = jackSignalNode(conn, input);
	const outputNode = jackSignalNode(conn, output);
	if (
		inputNode === undefined ||
		outputNode === undefined ||
		(conn.nodeMembers.get(inputNode)?.length ?? 0) < 2 ||
		(conn.nodeMembers.get(outputNode)?.length ?? 0) < 2
	) {
		return [
			connectivityIncompleteIssue(traceConnectivityCompleteness(doc, conn)),
		];
	}
	const nodeSets = audioNodeSets(doc, conn, options.nodeRoles, ports);
	return [
		...findInputLoadingWarnings(doc, conn, input, nodeSets),
		...findAudioShuntWarnings(doc, conn, input, output, nodeSets),
		...findOpampFeedbackWarnings(doc, conn, input, output, nodeSets),
	];
}

/** Connectivity-independent: flags R/C values off the E24 grid. Noisy — OPT-IN. */
export function validatePreferredValues(
	doc: CircuitDocument,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const c of doc.components) {
		if (c.kind !== "resistor" && c.kind !== "capacitor") continue;
		const v = componentValue(c);
		if (v == null || v <= 0 || isE24(v)) continue;
		issues.push({
			code: "trace-nonstandard-value",
			severity: "warning",
			message: `${c.id} value ${fmt(v)} is not a standard E24 value — verify transcription.`,
			componentId: c.id,
		});
	}
	return issues;
}

/** Rough RC-corner heuristic. High false-positive rate; OPT-IN only. Does NOT catch in-band slips. */
export function validateRcCornerHeuristic(
	doc: CircuitDocument,
	options: TracePlausibilityOptions = {},
): readonly ValidationIssue[] {
	const conn = options.connectivity ?? resolveConnectivity(doc);
	const [fLo, fHi] = options.audioBand ?? [0.2, 120000];
	const issues: ValidationIssue[] = [];
	const byId = new Map<string, Component>(doc.components.map((c) => [c.id, c]));
	const railNodes = new Set<number>();
	if (conn.groundNodeId != null) railNodes.add(conn.groundNodeId);
	for (const [nid, members] of conn.nodeMembers)
		for (const m of members) {
			const comp = byId.get(m.componentId);
			if (comp && SUPPLY_KINDS.has(comp.kind)) {
				railNodes.add(nid);
				break;
			}
		}
	for (const c of doc.components) {
		if (c.kind !== "capacitor") continue;
		const cv = componentValue(c);
		if (cv == null || cv <= 0) continue;
		const cNodes = nodesOf(conn, c);
		if (cv >= 1e-6 && cNodes.some((n) => railNodes.has(n))) continue;
		let flagged = false;
		for (const nid of cNodes) {
			if (flagged) break;
			for (const m of conn.nodeMembers.get(nid) ?? []) {
				const r = byId.get(m.componentId);
				if (r?.kind !== "resistor") continue;
				const rv = componentValue(r);
				if (rv == null || rv <= 0) continue;
				const f = 1 / (2 * Math.PI * rv * cv);
				if (f < fLo || f > fHi) {
					issues.push({
						code: "trace-rc-corner",
						severity: "warning",
						message: `${c.id}=${fmt(cv)}F with ${r.id}=${fmt(rv)} gives ~${f < 1 ? f.toFixed(2) : Math.round(f)} Hz corner (net #${nid}) — outside plausible range; verify.`,
						componentId: c.id,
					});
					flagged = true;
					break;
				}
			}
		}
	}
	return issues;
}

/** Default advisory run: structure only (coverage-gated). Opt-in extras via options. */
export function validateTracePlausibility(
	doc: CircuitDocument,
	options: TracePlausibilityOptions = {},
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [...validateTraceStructure(doc, options)];
	if (options.includeAudioTopology) {
		for (const issue of validateAudioTopologyWarnings(doc, options)) {
			if (
				issue.code === "trace-connectivity-incomplete" &&
				issues.some((existing) => existing.code === issue.code)
			) {
				continue;
			}
			issues.push(issue);
		}
	}
	if (options.includePreferredValue)
		issues.push(...validatePreferredValues(doc));
	if (options.includeRcCorner)
		issues.push(...validateRcCornerHeuristic(doc, options));
	return issues;
}
