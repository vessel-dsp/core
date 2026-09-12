import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
} from "../../../packages/core/src";

/**
 * `audio` declares which component is the input, which is the output, and whether a bypass switch
 * exists. It is a first-class field rather than a jack property because consumers were choosing an
 * output by inspecting jacks and guessing: `soldano-slo-100` declares four `Circuit.Speaker` jacks,
 * three of them monitor taps and one an effects send, with no speaker after its output transformer.
 * Every tool that read it silently measured a preamp monitor point, and none could report which
 * output it had picked.
 */
const body = `
metadata:
  name: Test
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

const withAudio = (schema: string, audio: string): string =>
	`schema: ${schema}\n${audio}${body}`;

const AUDIO_SWITCH = `audio:
  input: IN
  output: OUT
  bypass:
    switch: FSW
    engagedPosition: 1
`;
const AUDIO_NONE = `audio:
  input: IN
  output: OUT
  bypass: none
`;

describe("audio port declaration", () => {
	test("v4 requires the audio block", () => {
		expect(() =>
			parseInterchangeYaml(`schema: circuit-interchange/v4\n${body}`),
		).toThrow(/audio: required by schema circuit-interchange\/v4/);
	});

	test("v3 accepts a document without it", () => {
		const doc = parseInterchangeYaml(`schema: circuit-interchange/v3\n${body}`);
		expect(doc.audio).toBeUndefined();
	});

	test("v3 validates the block when it IS present", () => {
		const doc = parseInterchangeYaml(
			withAudio("circuit-interchange/v3", AUDIO_NONE),
		);
		expect(doc.audio).toEqual({ input: "IN", output: "OUT", bypass: "none" });
	});

	test("v2 refuses the block outright", () => {
		expect(() =>
			parseInterchangeYaml(withAudio("circuit-interchange/v2", AUDIO_NONE)),
		).toThrow(/audio: requires schema circuit-interchange\/v3/);
	});

	/**
	 * The distinction this whole field exists for. Some pedals have no bypass switch on purpose, so
	 * `"none"` must be expressible -- and it must not be the same value as saying nothing, because
	 * an absent field cannot be told from an oversight.
	 */
	test('"none" is a declaration and an absent bypass is an error', () => {
		expect(
			parseInterchangeYaml(withAudio("circuit-interchange/v4", AUDIO_NONE))
				.audio?.bypass,
		).toBe("none");
		expect(() =>
			parseInterchangeYaml(
				withAudio("circuit-interchange/v4", "audio:\n  input: IN\n  output: OUT\n"),
			),
		).toThrow(/audio\.bypass: required/);
	});

	test("a bypass switch carries the ENGAGED position", () => {
		const doc = parseInterchangeYaml(
			withAudio("circuit-interchange/v4", AUDIO_SWITCH),
		);
		expect(doc.audio?.bypass).toEqual({ switch: "FSW", engagedPosition: 1 });
	});

	test("a malformed bypass is refused rather than coerced", () => {
		expect(() =>
			parseInterchangeYaml(
				withAudio("circuit-interchange/v4", "audio:\n  input: IN\n  output: OUT\n  bypass: maybe\n"),
			),
		).toThrow(/audio\.bypass: expected "none"/);
		expect(() =>
			parseInterchangeYaml(
				withAudio(
					"circuit-interchange/v4",
					"audio:\n  input: IN\n  output: OUT\n  bypass:\n    switch: FSW\n",
				),
			),
		).toThrow(/engagedPosition/);
	});

	test("a v4 document survives parse-then-serialize unchanged", () => {
		const text = withAudio("circuit-interchange/v4", AUDIO_SWITCH);
		const once = serializeInterchangeYaml(parseInterchangeYaml(text));
		const twice = serializeInterchangeYaml(parseInterchangeYaml(once));
		expect(once).toBe(twice);
		expect(once).toContain("schema: circuit-interchange/v4");
		const round = parseInterchangeYaml(once);
		expect(round.audio).toEqual({
			input: "IN",
			output: "OUT",
			bypass: { switch: "FSW", engagedPosition: 1 },
		});
	});

	/**
	 * MULTI-CHANNEL PORTS. 0.7.0 said `audio.output` was exactly one component id, which meant a
	 * stereo pedal could not declare itself -- `boss-ce-2b` and others carry
	 * `stereo-output-left`/`stereo-output-right`. Refusing every stereo pedal is not a policy; it is
	 * the schema failing to describe the device.
	 */
	test("a port accepts an ordered array, and order is channel order", () => {
		const doc = parseInterchangeYaml(
			withAudio(
				"circuit-interchange/v4",
				"audio:\n  input: IN\n  output:\n    - OUT_L\n    - OUT_R\n  bypass: none\n",
			),
		);
		expect(doc.audio?.output).toEqual(["OUT_L", "OUT_R"]);
		expect(doc.audio?.input).toBe("IN");
	});

	test("the same jack twice is a defect, not a stereo pair", () => {
		expect(() =>
			parseInterchangeYaml(
				withAudio(
					"circuit-interchange/v4",
					"audio:\n  input: IN\n  output:\n    - OUT\n    - OUT\n  bypass: none\n",
				),
			),
		).toThrow(/duplicate component id "OUT"/);
	});

	test("an empty array is refused", () => {
		expect(() =>
			parseInterchangeYaml(
				withAudio(
					"circuit-interchange/v4",
					"audio:\n  input: IN\n  output: []\n  bypass: none\n",
				),
			),
		).toThrow(/at least one component id/);
	});

	/**
	 * The field holds component ids and nothing else. `AudioRole` on `boss-ch-1` holds the sentence
	 * "wet-only when stereo output is used" -- a producer writing prose into a field a consumer
	 * parses strictly -- so the error says what this field accepts rather than only that the value
	 * was wrong.
	 */
	test("prose is refused with text that says what the field holds", () => {
		expect(() =>
			parseInterchangeYaml(
				withAudio(
					"circuit-interchange/v4",
					"audio:\n  input: IN\n  output: 42\n  bypass: none\n",
				),
			),
		).toThrow(/component ids and nothing else/);
	});

	/**
	 * THE STRENGTHENED NULL. An array that survives the round trip as its FIRST ELEMENT, or with
	 * its channels swapped, is exactly the failure this widening exists to prevent -- and a
	 * round-trip test that cannot see either is not testing the thing it is named after.
	 */
	test("a multi-channel port must not collapse or reorder across a round trip", () => {
		const text = withAudio(
			"circuit-interchange/v4",
			"audio:\n  input: IN\n  output:\n    - OUT_L\n    - OUT_R\n  bypass: none\n",
		);
		const once = serializeInterchangeYaml(parseInterchangeYaml(text));
		expect(parseInterchangeYaml(once).audio?.output).toEqual([
			"OUT_L",
			"OUT_R",
		]);

		const collapsed = once.replace(
			/output:\n\s+- OUT_L\n\s+- OUT_R/,
			"output: OUT_L",
		);
		expect(collapsed).not.toBe(once);
		expect(parseInterchangeYaml(collapsed).audio?.output).not.toEqual([
			"OUT_L",
			"OUT_R",
		]);

		const swapped = once.replace(
			/(output:\n\s+- )OUT_L(\n\s+- )OUT_R/,
			"$1OUT_R$2OUT_L",
		);
		expect(swapped).not.toBe(once);
		expect(parseInterchangeYaml(swapped).audio?.output).not.toEqual([
			"OUT_L",
			"OUT_R",
		]);
	});

	/**
	 * THE NULL. A round-trip test that passes when the block is silently dropped is not a
	 * round-trip test. This asserts the failure directly: strip `audio` from the serialized form
	 * and the result must no longer parse as v4.
	 */
	test("the round-trip test FAILS if the audio block is dropped", () => {
		const once = serializeInterchangeYaml(
			parseInterchangeYaml(withAudio("circuit-interchange/v4", AUDIO_SWITCH)),
		);
		const stripped = once
			.split("\n")
			.filter(
				(line) =>
					!/^audio:/.test(line) &&
					!/^\s+(input|output|bypass|switch|engagedPosition):/.test(line),
			)
			.join("\n");
		expect(stripped).not.toContain("audio:");
		expect(() => parseInterchangeYaml(stripped)).toThrow(
			/audio: required by schema circuit-interchange\/v4/,
		);
	});
});
