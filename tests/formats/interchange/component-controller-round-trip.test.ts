import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
} from "../../../packages/core/src";

/**
 * A microcontroller's firmware rule -- a footswitch press toggles a latch, and a pin follows it --
 * is the one fact about a CPU-switched pedal the circuit cannot state. It must survive the format,
 * and a declaration no consumer could execute must be refused rather than carried.
 */
const shell = (controller: string, supplyRoles = true) => `schema: circuit-interchange/v2
metadata:
  name: "Controller shell"
  description: "A CPU that toggles an effect latch from a footswitch and drives a lamp pin."
  partNumber: ""
source:
  format: interchange
  filename: component-controller-round-trip.vdsp
components:
  - id: CPU
    kind: ic
    name: CPU
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: p10
        role: pin
        node: 1
        position:
          x: 0
          y: 0
      - name: p12
        role: pin
        node: 2
        position:
          x: 10
          y: 0
      - name: vcc
        role: ${supplyRoles ? "supplyPositive" : "pin"}
        node: 3
        position:
          x: 20
          y: 0
      - name: vss
        role: ${supplyRoles ? "supplyNegative" : "pin"}
        node: 0
        position:
          x: 30
          y: 0
${controller}wires: []
`;

const good = `    controller:
      latches:
        - id: EFFECT
          toggledBy: SW1
          initial: 0
          source: "Owner's manual p.6: each press of the pedal switch turns the effect on or off"
      pins:
        - terminal: p12
          follows: EFFECT
          source: "Service notes p.3: the CHECK indicator is driven from this pin"
        - terminal: p10
          follows: EFFECT
          invert: true
          source: "test"
`;

describe("a component's controller", () => {
	test("parses latches and pins", () => {
		const cpu = parseInterchangeYaml(shell(good)).components[0]!;
		expect(cpu.controller?.latches).toEqual([
			{ id: "EFFECT", toggledBy: "SW1", initial: 0, source: "Owner's manual p.6: each press of the pedal switch turns the effect on or off" },
		]);
		expect(cpu.controller?.pins?.map((pin) => [pin.terminal, pin.follows, pin.invert ?? false])).toEqual([
			["p12", "EFFECT", false],
			["p10", "EFFECT", true],
		]);
	});

	test("round-trips through the serializer unchanged", () => {
		const once = parseInterchangeYaml(shell(good));
		const twice = parseInterchangeYaml(serializeInterchangeYaml(once));
		expect(twice.components[0]!.controller).toEqual(once.components[0]!.controller);
	});

	test("a component with no controller keeps none", () => {
		expect(parseInterchangeYaml(shell("")).components[0]!.controller).toBeUndefined();
	});

	test("refuses a declaration no consumer could execute", () => {
		const latch = (extra: string) => `    controller:
      latches:
        - id: EFFECT
          toggledBy: SW1
          initial: 0
          source: "test"
${extra}`;
		expect(() => parseInterchangeYaml(shell("    controller:\n      latches: []\n"))).toThrow(/at least one latch/);
		expect(() => parseInterchangeYaml(shell(latch("").replace("initial: 0", "initial: 2")))).toThrow(/0 or 1/);
		expect(() => parseInterchangeYaml(shell(latch("").replace('source: "test"', 'source: " "')))).toThrow(/cite one/);
		expect(() => parseInterchangeYaml(shell(latch(`        - id: EFFECT
          toggledBy: SW2
          initial: 1
          source: "test"
`)))).toThrow(/declared twice/);
		expect(() => parseInterchangeYaml(shell(latch(`      pins:
        - terminal: p99
          follows: EFFECT
          source: "test"
`)))).toThrow(/not a terminal/);
		expect(() => parseInterchangeYaml(shell(latch(`      pins:
        - terminal: p12
          follows: HOLD
          source: "test"
`)))).toThrow(/not a latch/);
		expect(() => parseInterchangeYaml(shell(good, false))).toThrow(/supplyPositive/);
	});

	test("a pin can be high at a control's detents instead of following a latch", () => {
		const modes = `    controller:
      latches:
        - id: EFFECT
          toggledBy: SW1
          initial: 0
          source: "test"
      pins:
        - terminal: p10
          highAt:
            control: MODE
            positions:
              - 6
          source: "Owner's manual p.7: in Mode 7 only effect sound is output through the Output Jack"
`;
		const once = parseInterchangeYaml(shell(modes));
		expect(once.components[0]!.controller?.pins?.[0]?.highAt).toEqual({ control: "MODE", positions: [6] });
		const twice = parseInterchangeYaml(serializeInterchangeYaml(once));
		expect(twice.components[0]!.controller).toEqual(once.components[0]!.controller);
		const pin = (body: string) => `    controller:
      latches:
        - id: EFFECT
          toggledBy: SW1
          initial: 0
          source: "test"
      pins:
        - terminal: p10
${body}          source: "test"
`;
		expect(() => parseInterchangeYaml(shell(pin("")))).toThrow(/exactly one rule/);
		expect(() => parseInterchangeYaml(shell(pin("          follows: EFFECT\n          highAt:\n            control: MODE\n            positions:\n              - 6\n")))).toThrow(/exactly one rule/);
		expect(() => parseInterchangeYaml(shell(pin("          highAt:\n            control: MODE\n            positions: []\n")))).toThrow(/at least one detent|expected array/);
		expect(() => parseInterchangeYaml(shell(pin("          highAt:\n            control: MODE\n            positions:\n              - 6\n              - 6\n")))).toThrow(/none repeated/);
	});

	test("an ic may declare its supply pins", () => {
		const cpu = parseInterchangeYaml(shell(good)).components[0]!;
		expect(cpu.terminals.map((terminal) => terminal.role)).toEqual(["pin", "pin", "supplyPositive", "supplyNegative"]);
	});
});
