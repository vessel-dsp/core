// A component's declared program, checked against the vocabulary that can actually execute it.
//
// The format carries an op as a name plus an untyped bag, because `@vessel-dsp/core` has no
// opinion about a vocabulary that belongs to the runtime. That is the right split, and it puts the
// whole burden of the check here: everything downstream of this file sees a `PrimitiveOp` or a
// refusal, never a declaration that has not been read.
//
// **Why this refuses rather than drops.** An `ic` with no model is opened with a warning and the
// packet renders silence -- the gap CLAUDE.md records as costing a session on 2026-09-10, where
// the engine could not tell an unimplemented DSP pedal from an analog pedal with a severed net. A
// *declared* program is different in kind: the source has stated what the chip does, so failing to
// execute it is this compiler's gap and not the document's, and the console/ROM invariant applies
// in full. An op this pipeline cannot place is named, never silently discarded.

import type {
	ComposedGainSweep,
	ComposedSource,
	ComposedTerm,
	DeclaredProgram,
	DeclaredProgramOp,
	DeclaredProgramParameter,
	DelayLengthSpec,
	PrimitiveOp,
} from "./types";

/** A declaration that checked out, or the first reason it did not. */
export type DeclaredProgramCheck =
	| {
			readonly ok: true;
			readonly positions: readonly CheckedPosition[];
	  }
	| { readonly ok: false; readonly reason: string };

export type CheckedPosition = {
	readonly id: string;
	readonly ops: readonly PrimitiveOp[];
	readonly lines: readonly string[];
};

/**
 * Every op name the runtime can execute, as a map that the type checker keeps exhaustive.
 *
 * **Not a hand-written list.** Keying a `Record` on `PrimitiveOp["op"]` means adding an op to the
 * union and forgetting it here is a type error, which is the only version of this table that
 * cannot go stale. A hand-listed array of strings would compile forever after the union moved --
 * and a validator that silently stops recognising a new op is worse than none, because it refuses
 * a correct declaration and names the source as the defect.
 */
const OP_READERS: {
	readonly [K in PrimitiveOp["op"]]: (
		op: DeclaredProgramOp,
		parameters: Readonly<Record<string, DeclaredProgramParameter>>,
	) => Extract<PrimitiveOp, { op: K }> | string;
} = {
	"delay-tap": (op) => {
		const line = readLine(op);
		if (line === null) return NO_LINE;
		const length = readLength(op);
		if (typeof length === "string") return length;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "delay-tap", line, length, out };
	},
	"delay-tap-fractional": (op) => {
		const line = readLine(op);
		if (line === null) return NO_LINE;
		const length = readLength(op);
		if (typeof length === "string") return length;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "delay-tap-fractional", line, length, out };
	},
	"delay-tap-reverse": (op) => {
		const line = readLine(op);
		if (line === null) return NO_LINE;
		const length = readLength(op);
		if (typeof length === "string") return length;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "delay-tap-reverse", line, length, out };
	},
	"hold-loop": (op, parameters) => {
		const line = readLine(op);
		if (line === null) return NO_LINE;
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const raw = op.gate;
		if (raw === null || typeof raw !== "object") return 'declares no "gate" parameter';
		const gate = readGainParameter(raw, parameters, "gate");
		if (typeof gate === "string") return gate;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "hold-loop", line, input, gate, out };
	},
	"delay-push": (op) => {
		const line = readLine(op);
		if (line === null) return NO_LINE;
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		return { op: "delay-push", line, input };
	},
	mix: (op, parameters) => {
		const terms = readTerms(op, parameters);
		if (typeof terms === "string") return terms;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "mix", terms, out };
	},
	"filter-dcblock": (op) => {
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "filter-dcblock", input, out };
	},
	comb: (op) => {
		const index = readNumber(op.index, "index");
		if (typeof index === "string") return index;
		const decaySeconds = readNumber(op.decaySeconds, "decaySeconds");
		if (typeof decaySeconds === "string") return decaySeconds;
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "comb", index, decaySeconds, input, out };
	},
	allpass: (op) => {
		const index = readNumber(op.index, "index");
		if (typeof index === "string") return index;
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "allpass", index, input, out };
	},
	"pitch-shift": (op) => {
		const ratio = readNumber(op.ratio, "ratio");
		if (typeof ratio === "string") return ratio;
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "pitch-shift", ratio, input, out };
	},
	"pitch-tracker": (op) => {
		const input = readSource(op.input, "input");
		if (typeof input === "string") return input;
		const out = readOut(op);
		if (typeof out === "string") return out;
		return { op: "pitch-tracker", input, out };
	},
};

/** The declared op names, for a refusal that can tell a reader what it could have written. */
const KNOWN_OPS: readonly string[] = Object.keys(OP_READERS).sort();

/**
 * Read a declaration into executable ops, or name the first thing that stopped it.
 *
 * Positions are checked in declaration order and the check stops at the first failure, because a
 * list of every defect in a document nobody has fixed once is noise. The reason names the position
 * and the op index, which is what locates it in the source.
 */
export function checkDeclaredProgram(
	program: DeclaredProgram,
): DeclaredProgramCheck {
	const positions: CheckedPosition[] = [];
	for (const position of program.positions) {
		// Core refuses an empty `ops` at parse, so an empty list here means stage 1 dropped
		// every entry as unreadable. Letting it through would publish an unwritten temporary,
		// which is a packet that compiles clean and renders silence -- the failure this whole
		// file exists to make impossible.
		if (position.ops.length === 0) {
			return {
				ok: false,
				reason: `position "${position.id}" carries no readable op`,
			};
		}
		const ops: PrimitiveOp[] = [];
		for (const [index, declared] of position.ops.entries()) {
			const reader = Object.hasOwn(OP_READERS, declared.op)
				? OP_READERS[declared.op as PrimitiveOp["op"]]
				: undefined;
			if (reader === undefined) {
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} declares "${declared.op}", which this runtime does not implement; it executes ${KNOWN_OPS.join(", ")}`,
				};
			}
			const read = reader(declared, position.parameters);
			if (typeof read === "string") {
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} ("${declared.op}"): ${read}`,
				};
			}
			ops.push(read);
		}
		// **Temporaries are sized to the op list**, one slot per op, in both consoles. An `out` or a
		// temp source past it is a write or read of a slot that does not exist: the C++ console
		// throws on the first sample and the TS console silently grows its array, so the two
		// disagree and the Studio crashes where a render passes. `boss-dd-5` v1.46's HOLD wrote
		// slot 3 of a two-op program.
		for (const [index, op] of ops.entries()) {
			const slots = [
				...("out" in op ? [["out", op.out] as const] : []),
				...tempSources(op).map((slot) => ["temp source", slot] as const),
			];
			for (const [what, slot] of slots) {
				if (slot < ops.length) continue;
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} ("${op.op}") names ${what} ${slot}, outside its ${ops.length} temporaries (one per op)`,
				};
			}
		}
		// A delay op naming a line the position does not declare has no length to read, and
		// taking it as zero would render a silent pedal that compiled cleanly.
		const declaredLines = new Set(Object.keys(position.lines));
		for (const [index, op] of ops.entries()) {
			if (!("line" in op)) continue;
			if (!declaredLines.has(op.line)) {
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} ("${op.op}") reads delay line "${op.line}", which the position does not declare; it declares ${declaredLines.size === 0 ? "none" : [...declaredLines].join(", ")}`,
				};
			}
		}
		// A reverse tap keeps its segment phase on the line it reads, so a second one on the same
		// line would advance that phase twice a sample and play at double speed.
		const reversed = new Set<string>();
		for (const [index, op] of ops.entries()) {
			if (op.op !== "delay-tap-reverse") continue;
			if (reversed.has(op.line)) {
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} is a second "delay-tap-reverse" on line "${op.line}"; a line carries at most one, because its reverse phase lives on the line`,
				};
			}
			reversed.add(op.line);
		}
		// A hold sampler owns its line: its record position lives there, so a second writer
		// would overwrite the recording it is looping.
		const held = new Set<string>();
		for (const [index, op] of ops.entries()) {
			if (op.op !== "hold-loop") continue;
			const shared = held.has(op.line) || ops.some((other) => other.op === "delay-push" && other.line === op.line);
			if (shared) {
				return {
					ok: false,
					reason: `position "${position.id}" op ${index} ("hold-loop") shares line "${op.line}" with another writer; a hold sampler owns its line`,
				};
			}
			held.add(op.line);
		}
		positions.push({
			id: position.id,
			ops,
			lines: [...declaredLines],
		});
	}
	return { ok: true, positions };
}

/** The temp slots an op reads. */
function tempSources(op: PrimitiveOp): readonly number[] {
	const sources: ComposedSource[] = [];
	if ("input" in op) sources.push(op.input);
	if (op.op === "mix") sources.push(...op.terms.map((term) => term.source));
	return sources.flatMap((source) => (source.kind === "temp" ? [source.index] : []));
}

/** The reason every delay op gives when it names no line, stated once. */
const NO_LINE = 'declares no delay line name ("line")';

function readLine(op: DeclaredProgramOp): string | null {
	const value = op.line;
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readOut(op: DeclaredProgramOp): number | string {
	return readIndex(op.out, "out");
}

function readNumber(value: unknown, field: string): number | string {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: `declares no finite "${field}"`;
}

function readIndex(value: unknown, field: string): number | string {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: `declares no non-negative integer "${field}"`;
}

function readLength(op: DeclaredProgramOp): DelayLengthSpec | string {
	const value = op.length;
	if (value === null || typeof value !== "object") {
		return 'declares no "length"';
	}
	const mode = (value as { mode?: unknown }).mode;
	// Whole-value comparison against the closed set, which is the rule this repository runs on
	// every other typed vocabulary.
	if (
		mode === "capacity" ||
		mode === "clock" ||
		mode === "modulation" ||
		mode === "parameter"
	) {
		return { mode };
	}
	return `declares length mode ${JSON.stringify(mode)}, which is not one of capacity, clock, modulation, parameter`;
}

function readSource(value: unknown, field: string): ComposedSource | string {
	if (value === null || typeof value !== "object") {
		return `declares no "${field}"`;
	}
	const kind = (value as { kind?: unknown }).kind;
	if (kind === "input") return { kind: "input" };
	if (kind === "const") {
		const amount = readNumber((value as { value?: unknown }).value, `${field}.value`);
		return typeof amount === "string" ? amount : { kind: "const", value: amount };
	}
	if (kind === "temp") {
		const index = readIndex((value as { index?: unknown }).index, `${field}.index`);
		return typeof index === "string" ? index : { kind: "temp", index };
	}
	return `declares ${field} kind ${JSON.stringify(kind)}, which is not one of input, const, temp`;
}

function readTerms(
	op: DeclaredProgramOp,
	parameters: Readonly<Record<string, DeclaredProgramParameter>>,
): readonly ComposedTerm[] | string {
	const value = op.terms;
	if (!Array.isArray(value) || value.length === 0) {
		return 'declares no non-empty "terms"';
	}
	const terms: ComposedTerm[] = [];
	for (const [index, entry] of value.entries()) {
		if (entry === null || typeof entry !== "object") {
			return `term ${index} is not an object`;
		}
		const source = readSource(
			(entry as { source?: unknown }).source,
			`terms[${index}].source`,
		);
		if (typeof source === "string") return source;
		const rawGain = (entry as { gain?: unknown }).gain;
		if (rawGain !== null && typeof rawGain === "object") {
			const sweep = readGainParameter(rawGain, parameters, `terms[${index}].gain`);
			if (typeof sweep === "string") return sweep;
			terms.push({ source, gain: sweep.min, sweep });
			continue;
		}
		const gain = readNumber(rawGain, `terms[${index}].gain`);
		if (typeof gain === "string") return gain;
		terms.push({ source, gain });
	}
	return terms;
}

/**
 * A gain that names a position parameter, resolved to the knob that sweeps it, or why not.
 *
 * Four refusals, each a declaration that cannot be executed faithfully. A name the position does
 * not declare has nothing to read. A parameter with no `source` is not set, by the format's own
 * rule, so a gain cannot be read from it. A parameter no control sweeps is a fixed number and
 * belongs in `gain` as one. And a `node` read has no port a gain could arrive through: the
 * control-to-chip path would have to be modelled, which is exactly what `scanned` says it is not.
 */
function readGainParameter(
	raw: object,
	parameters: Readonly<Record<string, DeclaredProgramParameter>>,
	field: string,
): ComposedGainSweep | string {
	const name = (raw as { parameter?: unknown }).parameter;
	if (typeof name !== "string" || name.length === 0) {
		return `${field} is an object but names no "parameter"`;
	}
	const parameter = parameters[name];
	if (parameter === undefined) {
		const declared = Object.keys(parameters);
		return `${field} names parameter "${name}", which the position does not declare; it declares ${declared.length === 0 ? "none" : declared.join(", ")}`;
	}
	if (parameter.source === undefined) {
		return `${field} names parameter "${name}", which cites no source and so is not set`;
	}
	if (parameter.control === undefined) {
		return `${field} names parameter "${name}", which no control sweeps; a fixed gain is written as a number`;
	}
	if (parameter.read !== "scanned") {
		return `${field} names parameter "${name}", read from a node; a gain has no node port, so only a scanned control can sweep one`;
	}
	if (!Number.isFinite(parameter.min) || !Number.isFinite(parameter.max)) {
		return `${field} names parameter "${name}", whose range is not two finite numbers`;
	}
	return { controlId: parameter.control, min: parameter.min, max: parameter.max };
}
