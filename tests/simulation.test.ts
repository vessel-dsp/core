import { describe, expect, test } from "bun:test";
import {
	CabinetIrNode,
	GainNode,
	InputProfileNode,
	NamNode,
	RuntimeNode,
	SignalChain,
} from "@vessel-dsp/chain";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { AudioEngine } from "@vessel-dsp/player";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const RC_LOW_PASS_VDSP = `schema: circuit-interchange/v3
metadata:
  name: "RC Low Pass"
  description: "Passive low pass filter."
  partNumber: ""
source:
  format: vdsp
  filename: rc_filter.vdsp
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -50
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -70
          y: 0
      - name: b
        node: 2
        position:
          x: -30
          y: 0
    properties:
      Resistance: "10k"
  - id: C1
    kind: capacitor
    name: C1
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 50
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 50
          y: 0
      - name: b
        node: 0
        position:
          x: 50
          y: -100
    properties:
      Capacitance: "10n"
`;

describe("Simulation & Signal Chain Packages", () => {
	test("compiler lowers .vdsp to executable Program ROM", () => {
		const result = compile(RC_LOW_PASS_VDSP, { registry: emptyRegistry });
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.program.blocks.length).toBeGreaterThan(0);
			const block = result.program.blocks[0];
			expect(block).toBeDefined();
			if (block && block.kind === "mna") {
				expect(block.nodeCount).toBeGreaterThan(0);
			}
		}
	});

	test("runtime solves compiled Program audio samples", () => {
		const compiled = compile(RC_LOW_PASS_VDSP, { registry: emptyRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;

		const runtime = new ReferenceRuntime(compiled.program);
		runtime.prepare(44100);

		const input = new Float64Array(64).fill(1.0);
		const output = runtime.process(input);

		expect(output.length).toBe(64);
		expect(output[output.length - 1]).toBeGreaterThan(0);
	});

	test("chain processes signal through guitar profile, pedal, NAM, cab IR, and master", () => {
		const compiled = compile(RC_LOW_PASS_VDSP, { registry: emptyRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok") return;

		const chain = new SignalChain({ sampleRate: 48000 });
		chain.inputProfile.setPickupType("humbucker");
		chain.inputProfile.setImpedance(500000);
		chain.inputProfile.setInputGainDb(2.0);

		const pedalNode = new RuntimeNode("rc-pedal", "RC Filter Pedal", compiled.program);
		const namNode = new NamNode("nam-lead", "Lead Amp", { gain: 2.0, master: 0.8 });
		const cabNode = new CabinetIrNode("cab-4x12", "Vintage 30 4x12");

		chain.addNode(pedalNode);
		chain.addNode(namNode);
		chain.addNode(cabNode);

		const input = new Float64Array(128).fill(0.2);
		const output = chain.process(input);

		expect(output.length).toBe(128);
		expect(Number.isFinite(output[output.length - 1])).toBe(true);

		// Test preset snapshot & restoration
		const preset = chain.getPreset("My Custom Rig");
		expect(preset.name).toBe("My Custom Rig");
		expect(preset.inputProfile.pickupType).toBe("humbucker");
		expect(preset.nodes.length).toBe(3);

		// Modify and restore
		chain.inputProfile.setPickupType("single-coil");
		expect(chain.inputProfile.getConfig().pickupType).toBe("single-coil");
		chain.loadPreset(preset);
		expect(chain.inputProfile.getConfig().pickupType).toBe("humbucker");
	});

	test("audio engine initializes and provides meter data", () => {
		const engine = new AudioEngine({ sampleRate: 48000 });
		expect(engine.playing).toBe(false);
		expect(engine.source).toBe("sample");

		const meter = engine.getMeterData();
		expect(meter.rmsDb).toBeLessThanOrEqual(0);
		expect(typeof meter.clipping).toBe("boolean");
	});
});
