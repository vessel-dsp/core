import { describe, expect, it } from "bun:test";
import { checkDeclaredProgram } from "../src/declared-program";
import type { DeclaredProgram } from "../src/types";

/**
 * The declaration arrives as an op name plus an untyped bag, because the format has no opinion
 * about a vocabulary that belongs to the runtime. Everything that makes it executable happens
 * here, so this is where both directions have to be proved: that a good declaration becomes the
 * ops it names, and that a bad one is refused rather than quietly dropped.
 */
const program = (
	ops: readonly Record<string, unknown>[],
	lines: Record<string, Record<string, { min: number; max: number }>> = {
		dl: { delaySeconds: { min: 0.001, max: 0.05 } },
	},
): DeclaredProgram =>
	({
		selector: null,
		positions: [{ id: "p1", label: null, ops, lines }],
	}) as unknown as DeclaredProgram;

describe("reading a declared program", () => {
	it("turns declared ops into the primitives they name", () => {
		const checked = checkDeclaredProgram(
			program([
				{ op: "filter-dcblock", input: { kind: "input" }, out: 0 },
				{
					op: "delay-tap-fractional",
					line: "dl",
					length: { mode: "parameter" },
					out: 1,
				},
				{ op: "delay-push", line: "dl", input: { kind: "temp", index: 0 } },
				{
					op: "mix",
					terms: [
						{ source: { kind: "temp", index: 1 }, gain: 0.5 },
						{ source: { kind: "const", value: 1 }, gain: 0 },
					],
					out: 2,
				},
			]),
		);
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;
		const ops = checked.positions[0]?.ops ?? [];
		expect(ops.map((op) => op.op)).toEqual([
			"filter-dcblock",
			"delay-tap-fractional",
			"delay-push",
			"mix",
		]);
		// The arguments survive as values, not as the strings the document wrote.
		expect(ops[1]).toEqual({
			op: "delay-tap-fractional",
			line: "dl",
			length: { mode: "parameter" },
			out: 1,
		});
		expect(ops[3]).toEqual({
			op: "mix",
			terms: [
				{ source: { kind: "temp", index: 1 }, gain: 0.5 },
				{ source: { kind: "const", value: 1 }, gain: 0 },
			],
			out: 2,
		});
	});

	it("refuses an op this runtime does not implement", () => {
		// The console/ROM invariant applied to the source: an op nothing can execute is named,
		// never dropped so the packet renders silence.
		const checked = checkDeclaredProgram(
			program([{ op: "reverse-buffer", line: "dl", out: 0 }]),
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		// The offending name is what locates the defect; the phrasing around it is not a contract.
		expect(checked.reason).toContain("reverse-buffer");
	});

	it("refuses a length mode outside the closed set", () => {
		const checked = checkDeclaredProgram(
			program([
				{ op: "delay-tap", line: "dl", length: { mode: "milliseconds" }, out: 0 },
			]),
		);
		expect(checked.ok).toBe(false);
	});

	it("refuses a delay op that names a line the position does not declare", () => {
		// Taking the missing line as zero length is how a pedal compiles clean and renders
		// nothing, which is the failure this whole check exists to make impossible.
		const checked = checkDeclaredProgram(
			program([
				{ op: "delay-tap", line: "absent", length: { mode: "parameter" }, out: 0 },
			]),
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(checked.reason).toContain("absent");
	});

	it("refuses an op missing a required argument, one field at a time", () => {
		for (const op of [
			{ op: "delay-tap", length: { mode: "parameter" }, out: 0 },
			{ op: "delay-tap", line: "dl", out: 0 },
			{ op: "delay-tap", line: "dl", length: { mode: "parameter" } },
			{ op: "filter-dcblock", out: 0 },
			{ op: "filter-dcblock", input: { kind: "nowhere" }, out: 0 },
			{ op: "mix", terms: [], out: 0 },
			{ op: "comb", index: 0, input: { kind: "input" }, out: 0 },
			{ op: "pitch-shift", input: { kind: "input" }, out: 0 },
		]) {
			expect(checkDeclaredProgram(program([op])).ok).toBe(false);
		}
	});

	it("refuses a position whose ops were all unreadable", () => {
		// Core refuses an empty op list at parse, so this state means stage 1 dropped every
		// entry. Letting it through publishes an unwritten temporary: a packet that compiles
		// clean and renders silence.
		expect(checkDeclaredProgram(program([])).ok).toBe(false);
	});

	it("accepts every op in the vocabulary, so the check can say yes as well as no", () => {
		// The positive control. A validator that has only ever refused has not been shown to
		// work -- the report-phaser-sweep lesson, applied before this one banks a verdict.
		const each: Record<string, unknown>[] = [
			{ op: "delay-tap", line: "dl", length: { mode: "capacity" }, out: 0 },
			{ op: "delay-tap-fractional", line: "dl", length: { mode: "clock" }, out: 1 },
			{ op: "delay-push", line: "dl", input: { kind: "input" } },
			{ op: "mix", terms: [{ source: { kind: "input" }, gain: 1 }], out: 2 },
			{ op: "filter-dcblock", input: { kind: "input" }, out: 3 },
			{
				op: "comb",
				index: 0,
				decaySeconds: 2,
				input: { kind: "input" },
				out: 4,
			},
			{ op: "allpass", index: 1, input: { kind: "input" }, out: 5 },
			{ op: "pitch-shift", ratio: 1.5, input: { kind: "input" }, out: 6 },
			{ op: "pitch-tracker", input: { kind: "input" }, out: 7 },
		];
		const checked = checkDeclaredProgram(program(each));
		expect(checked.ok).toBe(true);
		if (!checked.ok) return;
		expect(checked.positions[0]?.ops).toHaveLength(each.length);
	});

	it("refuses a temp slot outside the op list, written or read", () => {
		const written = checkDeclaredProgram(
			program([
				{ op: "filter-dcblock", input: { kind: "input" }, out: 3 },
				{ op: "mix", terms: [{ source: { kind: "temp", index: 0 }, gain: 1 }], out: 0 },
			]),
		);
		expect(written.ok).toBe(false);
		const read = checkDeclaredProgram(
			program([
				{ op: "filter-dcblock", input: { kind: "input" }, out: 0 },
				{ op: "mix", terms: [{ source: { kind: "temp", index: 2 }, gain: 1 }], out: 1 },
			]),
		);
		expect(read.ok).toBe(false);
		const inside = checkDeclaredProgram(
			program([
				{ op: "filter-dcblock", input: { kind: "input" }, out: 1 },
				{ op: "mix", terms: [{ source: { kind: "temp", index: 1 }, gain: 1 }], out: 0 },
			]),
		);
		expect(inside.ok).toBe(true);
	});
});
