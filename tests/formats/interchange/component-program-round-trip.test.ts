import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
} from "../../../packages/core/src";

/**
 * A reprogrammable chip's behaviour is not determined by its part number, so the format has to
 * carry which program **this instance** is running. Measured on the corpus this serves:
 * `TC25SC080AU-104` is a delay in `boss-dd-5`, a reverb in `boss-rv-3` and a pitch shifter in
 * `boss-hr-2`, and a catalog entry holds one model per part.
 *
 * The declaration must survive the format for the same reason `devices` and `windings` must: a
 * consumer that has to reconstruct it from prose or a sibling file is the defect it removes.
 */
const source = `schema: circuit-interchange/v2
metadata:
  name: "Programmed shell"
  description: "A reprogrammable DSP shell carrying a two-position delay program."
  partNumber: ""
source:
  format: interchange
  filename: component-program-round-trip.vdsp
components:
  - id: U1
    kind: ic
    name: U1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        role: pin
        node: 0
        position:
          x: 0
          y: 0
      - name: out
        role: pin
        node: 1
        position:
          x: 10
          y: 0
    program:
      router:
        control: "MODE"
        positions: 4
        routes:
          - position: 0
            program: delay-1
          - position: 2
            program: delay-2
      positions:
        - id: delay-1
          label: "DELAY 1"
          ops:
            - op: filter-dcblock
              input:
                kind: input
              out: 0
            - op: delay-tap-fractional
              line: dl
              length:
                mode: parameter
              out: 1
          lines:
            dl:
              delaySeconds:
                control: "D.TIME"
                min: 0.001
                max: 0.05
                source: "Service notes, MODE table"
        - id: delay-2
          label: "DELAY 2"
          ops:
            - op: delay-tap-fractional
              line: dl
              length:
                mode: parameter
              out: 0
          lines:
            dl:
              delaySeconds:
                min: 0.05
                max: 0.2
    properties: {}
wires: []
`;

describe("a component's program survives the format", () => {
	test("parses the selector, positions, ops and cited parameters", () => {
		const document = parseInterchangeYaml(source);
		const component = document.components[0];
		expect(component?.id).toBe("U1");
		const program = component?.program;
		expect(program).toBeDefined();
		if (program === undefined) return;

		expect(program.router?.control).toBe("MODE");
		expect(program.router?.positions).toBe(4);
		// Two detents routed out of four. The unrouted ones are not a gap: they are how an
		// undocumented mode is declared absent.
		expect(program.router?.routes).toEqual([
			{ position: 0, program: "delay-1" },
			{ position: 2, program: "delay-2" },
		]);
		expect(program.positions.map((position) => position.id)).toEqual([
			"delay-1",
			"delay-2",
		]);

		const first = program.positions[0];
		expect(first?.label).toBe("DELAY 1");
		// The op list is carried verbatim, including arguments this format has no opinion about:
		// the vocabulary belongs to the runtime that executes it.
		expect(first?.ops.map((op) => op.op)).toEqual([
			"filter-dcblock",
			"delay-tap-fractional",
		]);
		expect(first?.ops[1]?.line).toBe("dl");
		expect(first?.ops[1]?.length).toEqual({ mode: "parameter" });

		const delaySeconds = first?.lines?.dl?.delaySeconds;
		expect(delaySeconds?.control).toBe("D.TIME");
		expect(delaySeconds?.min).toBe(0.001);
		expect(delaySeconds?.max).toBe(0.05);
		expect(delaySeconds?.source).toBe("Service notes, MODE table");
	});

	test("an uncited parameter stays uncited, because that is a statement", () => {
		// Omitting `source` says the parameter is not evidenced and the program makes no claim on
		// that axis. If the format invented a citation here, an undocumented mode would become
		// indistinguishable from a documented one.
		const document = parseInterchangeYaml(source);
		const second = document.components[0]?.program?.positions[1];
		expect(second?.lines?.dl?.delaySeconds?.source).toBeUndefined();
		expect(second?.lines?.dl?.delaySeconds?.min).toBe(0.05);
	});

	test("round-trips through the serializer unchanged", () => {
		const once = parseInterchangeYaml(source);
		const twice = parseInterchangeYaml(serializeInterchangeYaml(once));
		expect(twice.components[0]?.program).toEqual(once.components[0]?.program);
	});

	test("a component with no program keeps none, rather than gaining an empty one", () => {
		const withoutProgram = source.replace(
			/    program:\n(?:.*\n)*?    properties: \{\}\n/,
			"    properties: {}\n",
		);
		const document = parseInterchangeYaml(withoutProgram);
		expect(document.components[0]?.program).toBeUndefined();
	});

	test("refuses several positions with no router", () => {
		// The negative control. Two positions and nothing saying which control chooses between
		// them is a declaration that cannot be executed, and silently taking the first would be
		// the guess this format exists to prevent.
		const ambiguous = source.replace(
			/      router:\n(?:.*\n)*?      positions:/,
			"      positions:",
		);
		expect(() => parseInterchangeYaml(ambiguous)).toThrow(/router/);
	});

	test("a router reads a node by default", () => {
		const document = parseInterchangeYaml(source);
		expect(document.components[0]?.program?.router?.read).toBe("node");
		expect(document.components[0]?.program?.router?.scannedBy).toBeUndefined();
	});

	test("a scanned router names the chip that reads the control", () => {
		// The case this exists for: a control whose path to the chip no source resolves, while
		// the panel fact is fully documented. Naming the reader keeps it a checkable claim
		// about a specific chip rather than a way to make any dangling control look alive.
		const scanned = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: scanned\n        scannedBy: U1\n',
		);
		const document = parseInterchangeYaml(scanned);
		const router = document.components[0]?.program?.router;
		expect(router?.read).toBe("scanned");
		expect(router?.scannedBy).toBe("U1");
		// And it survives the format, like every other declaration here.
		const twice = parseInterchangeYaml(serializeInterchangeYaml(document));
		expect(twice.components[0]?.program?.router).toEqual(router);
	});

	test("refuses a scanned router that names nothing, or nothing real", () => {
		const noReader = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: scanned\n',
		);
		expect(() => parseInterchangeYaml(noReader)).toThrow(/scannedBy/);

		const ghost = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: scanned\n        scannedBy: NOT_A_COMPONENT\n',
		);
		expect(() => parseInterchangeYaml(ghost)).toThrow(/not a component in this document/);

		const wrongMode = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: node\n        scannedBy: U1\n',
		);
		expect(() => parseInterchangeYaml(wrongMode)).toThrow(/scannedBy/);

		const unknownRead = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: telepathy\n',
		);
		expect(() => parseInterchangeYaml(unknownRead)).toThrow(/node.*scanned|scanned.*node/);
	});

	test("a parameter declares no read unless it says so", () => {
		// Existing documents must round-trip byte-identically: a default is not written back.
		const document = parseInterchangeYaml(source);
		const delay = document.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds;
		expect(delay?.read).toBeUndefined();
		expect(delay?.scannedBy).toBeUndefined();
		expect(serializeInterchangeYaml(document)).not.toContain("scannedBy");
	});

	test("a scanned parameter names the chip that reads its control, and survives the format", () => {
		// The DD-5 case: D.TIME's wiper reaches the CPU's ADC through the same untraceable
		// connector as MODE, so the parameter says what the router already could.
		const scanned = source.replace(
			'                control: "D.TIME"\n',
			'                control: "D.TIME"\n                read: scanned\n                scannedBy: U1\n',
		);
		const document = parseInterchangeYaml(scanned);
		const delay = document.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds;
		expect(delay).toEqual({
			control: "D.TIME",
			read: "scanned",
			scannedBy: "U1",
			min: 0.001,
			max: 0.05,
			source: "Service notes, MODE table",
		});
		const twice = parseInterchangeYaml(serializeInterchangeYaml(document));
		expect(twice.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds).toEqual(delay);
	});

	test("refuses a scanned parameter that names no reader, nothing real, or no control", () => {
		const withRead = (lines: string) =>
			source.replace('                control: "D.TIME"\n', lines);
		expect(() =>
			parseInterchangeYaml(
				withRead('                control: "D.TIME"\n                read: scanned\n'),
			),
		).toThrow(/scannedBy/);
		expect(() =>
			parseInterchangeYaml(
				withRead(
					'                control: "D.TIME"\n                read: scanned\n                scannedBy: NOT_A_COMPONENT\n',
				),
			),
		).toThrow(/not a component in this document/);
		expect(() =>
			parseInterchangeYaml(
				withRead(
					'                control: "D.TIME"\n                read: node\n                scannedBy: U1\n',
				),
			),
		).toThrow(/scannedBy/);
		// Scanning nothing is not a reading.
		expect(() =>
			parseInterchangeYaml(
				withRead('                read: scanned\n                scannedBy: U1\n'),
			),
		).toThrow(/names the control/);
	});

	test("a position declares named parameters an op refers to, and both survive the format", () => {
		// F.BACK on a DD-5 is a gain on the program's mix, not a property of its delay line.
		const withParameters = source
			.replace(
				'            - op: filter-dcblock\n',
				'            - op: mix\n              terms:\n                - source:\n                    kind: input\n                  gain:\n                    parameter: feedback\n              out: 2\n            - op: filter-dcblock\n',
			)
			.replace(
				'                source: "Service notes, MODE table"\n',
				'                source: "Service notes, MODE table"\n          parameters:\n            feedback:\n              control: "FBack"\n              read: scanned\n              scannedBy: U1\n              min: 0\n              max: 0.9\n              source: "stated approximation"\n',
			);
		const document = parseInterchangeYaml(withParameters);
		const position = document.components[0]?.program?.positions[0];
		expect(position?.parameters?.feedback).toEqual({
			control: "FBack",
			read: "scanned",
			scannedBy: "U1",
			min: 0,
			max: 0.9,
			source: "stated approximation",
		});
		expect(position?.ops[0]).toEqual({
			op: "mix",
			terms: [{ source: { kind: "input" }, gain: { parameter: "feedback" } }],
			out: 2,
		});
		const twice = parseInterchangeYaml(serializeInterchangeYaml(document));
		expect(twice.components[0]?.program?.positions[0]).toEqual(position);
	});

	test("a position's scanned parameter is held to the same reader check", () => {
		const ghost = source.replace(
			'                source: "Service notes, MODE table"\n',
			'                source: "Service notes, MODE table"\n          parameters:\n            feedback:\n              control: "FBack"\n              read: scanned\n              scannedBy: NOT_A_COMPONENT\n              min: 0\n              max: 0.9\n',
		);
		expect(() => parseInterchangeYaml(ghost)).toThrow(/parameters\.feedback\.scannedBy.*not a component/);
	});

	test("a tapped parameter scales the tapped interval, and survives the format", () => {
		// A DD-5 TEMPO position: the delay is a subdivision of the beat tapped on its TEMPO jack.
		const tapped = source.replace(
			'                control: "D.TIME"\n',
			'                control: "TEMPO"\n                read: tapped\n                scannedBy: U1\n                ratio: 0.75\n',
		);
		const document = parseInterchangeYaml(tapped);
		const delay = document.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds;
		expect(delay).toEqual({
			control: "TEMPO",
			read: "tapped",
			scannedBy: "U1",
			ratio: 0.75,
			min: 0.001,
			max: 0.05,
			source: "Service notes, MODE table",
		});
		const twice = parseInterchangeYaml(serializeInterchangeYaml(document));
		expect(twice.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds).toEqual(delay);
	});

	test("refuses a tapped read with no reader, a ratio off a tapped read, a bad ratio, and a tapped router", () => {
		const line = (body: string) =>
			source.replace('                control: "D.TIME"\n', body);
		expect(() =>
			parseInterchangeYaml(line('                control: "TEMPO"\n                read: tapped\n')),
		).toThrow(/scannedBy/);
		expect(() =>
			parseInterchangeYaml(
				line('                control: "D.TIME"\n                read: scanned\n                scannedBy: U1\n                ratio: 0.5\n'),
			),
		).toThrow(/only a tapped parameter/);
		expect(() =>
			parseInterchangeYaml(
				line('                control: "TEMPO"\n                read: tapped\n                scannedBy: U1\n                ratio: 0\n'),
			),
		).toThrow(/positive/);
		const tappedRouter = source.replace(
			'        control: "MODE"\n',
			'        control: "MODE"\n        read: tapped\n        scannedBy: U1\n',
		);
		expect(() => parseInterchangeYaml(tappedRouter)).toThrow(/read/);
	});

	test("a tapped parameter can carry the firmware's tap law, and it survives the format", () => {
		const law = source.replace(
			'                control: "D.TIME"\n',
			'                control: "TEMPO"\n                read: tapped\n                scannedBy: U1\n                tap:\n                  presses: 5\n                  timeoutSeconds: 2\n                  defaultSeconds: 0.3\n',
		);
		const document = parseInterchangeYaml(law);
		const delay = document.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds;
		expect(delay?.tap).toEqual({ presses: 5, timeoutSeconds: 2, defaultSeconds: 0.3 });
		const twice = parseInterchangeYaml(serializeInterchangeYaml(document));
		expect(twice.components[0]?.program?.positions[0]?.lines?.dl?.delaySeconds).toEqual(delay);
	});

	test("refuses a tap law off a tapped read, too few presses, and a non-positive time", () => {
		const line = (body: string) => source.replace('                control: "D.TIME"\n', body);
		const tapped = (law: string) =>
			line(`                control: "TEMPO"\n                read: tapped\n                scannedBy: U1\n                tap:\n${law}`);
		expect(() =>
			parseInterchangeYaml(line('                control: "D.TIME"\n                read: scanned\n                scannedBy: U1\n                tap:\n                  presses: 5\n                  timeoutSeconds: 2\n')),
		).toThrow(/only a tapped parameter has a tap law/);
		expect(() => parseInterchangeYaml(tapped("                  presses: 1\n                  timeoutSeconds: 2\n"))).toThrow(/at least two presses/);
		expect(() => parseInterchangeYaml(tapped("                  presses: 5\n                  timeoutSeconds: 0\n"))).toThrow(/positive time/);
		expect(() =>
			parseInterchangeYaml(tapped("                  presses: 5\n                  timeoutSeconds: 2\n                  defaultSeconds: -1\n")),
		).toThrow(/positive time/);
	});

	test("refuses a router that cannot be executed", () => {
		// Each of these is a mapping a consumer would have to guess at.
		const cases: [string, string][] = [
			["        positions: 4\n", "        positions: 1\n"],
			["            program: delay-1\n", "            program: nonexistent\n"],
			["          - position: 2\n", "          - position: 9\n"],
			["          - position: 2\n", "          - position: 0\n"],
		];
		for (const [from, to] of cases) {
			expect(() => parseInterchangeYaml(source.replace(from, to))).toThrow();
		}
	});

	test("a detent with no route is legal, and is the mechanism for an undocumented mode", () => {
		// The positive control in the other direction: the router must be able to say yes to a
		// partial mapping, or nothing could ever declare a subset of a panel's modes.
		const document = parseInterchangeYaml(source);
		const routed = new Set(
			(document.components[0]?.program?.router?.routes ?? []).map((r) => r.position),
		);
		expect(routed.has(1)).toBe(false);
		expect(routed.has(3)).toBe(false);
		expect(routed.size).toBe(2);
	});

	test("refuses an op with no name and a position with no ops", () => {
		const namelessOp = source.replace("            - op: filter-dcblock\n", "            - out: 9\n");
		expect(() => parseInterchangeYaml(namelessOp)).toThrow();

		const noOps = source.replace(
			/          ops:\n(?:.*\n)*?          lines:\n/,
			"          ops: []\n          lines:\n",
		);
		expect(() => parseInterchangeYaml(noOps)).toThrow(/at least one op/);
	});
});
