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
