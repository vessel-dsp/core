/**
 * trace-plausibility.ts — advisory `.vdsp` trace checks.
 *
 * Cheap, static heuristics that flag *suspicious* traces for a human/agent to
 * double-check against the source. Every issue is severity `"warning"`. This is
 * NOT a verifier and NOT a rating input, and it is deliberately incomplete: a
 * transcription slip that lands on a plausible value (e.g. `1n`->`1u`) passes
 * every static check here — catching that class requires a dynamic audio-
 * admission pass (simulation), which lives on the runtime side, not in this
 * static linter.
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
 *
 * `validateTracePlausibility` runs the safe default (structure only) plus any
 * opt-in checks requested via options.
 */
import {
	type Connectivity,
	getPinNode,
	resolveConnectivity,
} from "./connectivity";
import { propertyQuantityValue } from "./properties";
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
		return [
			{
				code: "trace-connectivity-incomplete",
				severity: "warning",
				message: `resolved net graph is only ${(cov.fraction * 100).toFixed(0)}% complete (${cov.connected}/${cov.total} terminals on a ≥2-member net); structural trace checks skipped (fail-closed). Provide complete connectivity to enable floating/shorted/divider checks.`,
			},
		];
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
				if (!r || r.kind !== "resistor") continue;
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
	if (options.includePreferredValue)
		issues.push(...validatePreferredValues(doc));
	if (options.includeRcCorner)
		issues.push(...validateRcCornerHeuristic(doc, options));
	return issues;
}
