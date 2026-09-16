import { describe, expect, test } from "bun:test";
import {
	AudioEngine,
	registerVesselPlayer,
	VesselPlayerElement,
} from "@vessel-dsp/player";

const SAMPLE_VDSP = `schema: circuit-interchange/v3
metadata:
  name: "RC Filter"
  description: "Passive RC filter."
  partNumber: ""
source:
  format: vdsp
  filename: fixture.vdsp
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
`;

describe("Phase 3: Embeddable Player", () => {
	test("AudioEngine manages chain, sources, and metering buffers", () => {
		const engine = new AudioEngine({ sampleRate: 48000, initialSource: "sample" });
		expect(engine.playing).toBe(false);
		expect(engine.source).toBe("sample");

		const meter = engine.getMeterData();
		expect(meter.rmsDb).toBeLessThanOrEqual(0);
		expect(meter.peakDb).toBeLessThanOrEqual(0);
		expect(meter.clipping).toBe(false);
	});

	test("VesselPlayerElement instantiates and compiles default vdsp source", () => {
		const el = new VesselPlayerElement();
		expect(el).toBeDefined();

		const compileRes = el.compileAndLoadSource(SAMPLE_VDSP);
		expect(compileRes.status).toBe("ok");
	});

	test("registerVesselPlayer helper runs without throwing", () => {
		expect(() => registerVesselPlayer()).not.toThrow();
	});
});
