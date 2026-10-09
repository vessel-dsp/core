// Band-limited oversampling against analytic filters (spike 2026-10-08).
//
// Pins the runtime's oversampled behaviour to exact analog answers, not to
// acceptance targets: the bands below admit the measured band-limited values
// and exclude the legacy hold-and-last ones, so they fail if the resampler
// regresses to a hold. Frequencies, levels and harness match the spike report
// (100 mV peak, stiff source, least-squares fundamental over a settled window).
import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";

const FS = 48_000;

const vdspWith = (parts: string): string => `schema: circuit-interchange/v3
metadata:
  name: "Oversample Control"
  description: "Passive control filter."
  partNumber: ""
source:
  format: vdsp
  filename: oversample_control.vdsp
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
${parts}`;

const seriesResistor = (ohms: string): string => `  - id: R1
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
      Resistance: "${ohms}"
`;

const shuntPart = (
	kind: string,
	sourceType: string,
	prop: string,
	value: string,
): string => `  - id: X1
    kind: ${kind}
    name: X1
    sourceTypeName: ${sourceType}
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
      ${prop}: "${value}"
`;

// R = 10k, C = 10n: fc = 1/(2*pi*R*C) = 1591.549 Hz (low-pass).
const RC_VDSP = vdspWith(
	seriesResistor("10k") +
		shuntPart("capacitor", "Circuit.Capacitor", "Capacitance", "10n"),
);
const RC_FC = 1 / (2 * Math.PI * 10e3 * 10e-9);
const exactRcDb = (f: number): number => -10 * Math.log10(1 + (f / RC_FC) ** 2);

// R = 1k, L = 10mH: fc = R/(2*pi*L) = 15915.494 Hz (high-pass).
const RL_VDSP = vdspWith(
	seriesResistor("1k") +
		shuntPart("inductor", "Circuit.Inductor", "Inductance", "10mH"),
);
const RL_FC = 1e3 / (2 * Math.PI * 10e-3);
const exactRlDb = (f: number): number => -10 * Math.log10(1 + (RL_FC / f) ** 2);

const fundamental = (y: Float64Array, fs: number, f: number): number => {
	let s00 = 0;
	let s01 = 0;
	let s02 = 0;
	let s11 = 0;
	let s12 = 0;
	let s22 = 0;
	let t0 = 0;
	let t1 = 0;
	let t2 = 0;
	for (let i = 0; i < y.length; i += 1) {
		const phase = (2 * Math.PI * f * i) / fs;
		const cos = Math.cos(phase);
		const sin = Math.sin(phase);
		const v = y[i] as number;
		s00 += 1;
		s01 += cos;
		s02 += sin;
		s11 += cos * cos;
		s12 += cos * sin;
		s22 += sin * sin;
		t0 += v;
		t1 += cos * v;
		t2 += sin * v;
	}
	const det =
		s00 * (s11 * s22 - s12 * s12) -
		s01 * (s01 * s22 - s12 * s02) +
		s02 * (s01 * s12 - s11 * s02);
	const b =
		(s00 * (t1 * s22 - s12 * t2) -
			t0 * (s01 * s22 - s12 * s02) +
			s02 * (s01 * t2 - t1 * s02)) /
		det;
	const c =
		(s00 * (s11 * t2 - t1 * s12) -
			s01 * (s01 * t2 - t1 * s02) +
			t0 * (s01 * s12 - s11 * s02)) /
		det;
	return Math.hypot(b, c);
};

const renderGainDb = (
	vdsp: string,
	freq: number,
	oversample: number,
	rate = FS,
): number => {
	const compiled = compile(vdsp, { registry: emptyRegistry });
	expect(compiled.status).toBe("ok");
	if (compiled.status !== "ok")
		throw new Error("control filter did not compile");
	const amp = 0.1;
	const runtime = new ReferenceRuntime(compiled.program);
	runtime.prepare(
		rate,
		oversample > 1
			? { inputSourceOhms: 0, oversample }
			: { inputSourceOhms: 0 },
	);
	runtime.process(new Float64Array(Math.round(0.1 * rate)));
	const n = Math.round(0.4 * rate);
	const input = new Float64Array(n);
	for (let i = 0; i < n; i += 1)
		input[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
	const out = runtime.process(input);
	const window = out.slice(Math.round(0.1 * rate), Math.round(0.4 * rate));
	expect(runtime.telemetry().nonConvergedSamples).toBe(0);
	return 20 * Math.log10(fundamental(window, rate, freq) / amp);
};

describe("band-limited oversampling against analytic filters", () => {
	it("renders the RC low-pass at 4x like a true 192 kHz solve, not a held one", () => {
		// Measured band-limited errors vs exact: -0.011 dB at 4 kHz, -0.046 dB
		// at 8 kHz, -0.105 dB at 12 kHz (the residue is the 192 kHz trapezoid
		// warp, identical in a native 192 kHz render to 0.006 dB). The legacy
		// hold path reads -0.020/-0.066 dB at 4/8 kHz and +0.030 dB off native
		// at 12 kHz, so the 12 kHz band below excludes it.
		for (const [freq, lo, hi] of [
			[4000, -0.03, 0.01],
			[8000, -0.07, -0.02],
		] as const) {
			const err = renderGainDb(RC_VDSP, freq, 4) - exactRcDb(freq);
			expect(err).toBeGreaterThan(lo);
			expect(err).toBeLessThan(hi);
		}
		const at12k = renderGainDb(RC_VDSP, 12000, 4);
		const native = renderGainDb(RC_VDSP, 12000, 1, 192_000);
		expect(at12k - native).toBeLessThan(0.01);
		expect(at12k - native).toBeGreaterThan(-0.01);
	});

	it("renders the RL high-pass at 4x within 0.1 dB of exact to 4 kHz", () => {
		// The legacy hold path is -8.4 dB off everywhere on this circuit (it
		// converges on the staircase-driven answer); the band-limited path is
		// +0.003/+0.012 dB at 1/4 kHz.
		for (const [freq, lo, hi] of [
			[1000, -0.02, 0.03],
			[4000, -0.01, 0.05],
		] as const) {
			const err = renderGainDb(RL_VDSP, freq, 4) - exactRlDb(freq);
			expect(err).toBeGreaterThan(lo);
			expect(err).toBeLessThan(hi);
		}
	});

	it("exposes the resampler latency in host samples", () => {
		const compiled = compile(RC_VDSP, { registry: emptyRegistry });
		expect(compiled.status).toBe("ok");
		if (compiled.status !== "ok")
			throw new Error("control filter did not compile");
		const runtime = new ReferenceRuntime(compiled.program);
		expect(runtime.oversampleLatency()).toBeNull();
		runtime.prepare(FS, { oversample: 4 });
		expect(runtime.oversampleLatency()).toBe(26.25);
	});
});
