// Stage 7: serialize a program to the runtime artifact.
//
// Deterministic by construction: keys are emitted in a fixed order, so the same
// program always produces the same bytes and the same digest. That is what lets a
// build cache, a container hash, or a corpus diff mean anything.
//
// The artifact carries no sample rate. A runtime supplies one at initialization and
// computes coefficients from it (decision 3), so one artifact is valid everywhere.

import type { Program } from "./types";

export type Artifact = {
	readonly text: string;
	readonly digest: string;
};

export function emit(program: Program): Artifact {
	const text = JSON.stringify(program, orderedKeys);
	return { text, digest: digestOf(text) };
}

export function decode(text: string): Program {
	const parsed = JSON.parse(text) as Program;
	if (parsed.formatVersion !== 1) {
		throw new Error(
			`unsupported program format version ${parsed.formatVersion}`,
		);
	}
	return parsed;
}

/** Stable key order, so serialization is a function of the program alone. */
function orderedKeys(_key: string, value: unknown): unknown {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	const record = value as Record<string, unknown>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = record[key];
	}
	return sorted;
}

/** FNV-1a, 64-bit, hex. Enough to detect change; not a security primitive. */
function digestOf(text: string): string {
	let hash = 0xcbf2_9ce4_8422_2325n;
	const prime = 0x0000_0100_0000_01b3n;
	const mask = 0xffff_ffff_ffff_ffffn;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= BigInt(text.charCodeAt(index));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}
