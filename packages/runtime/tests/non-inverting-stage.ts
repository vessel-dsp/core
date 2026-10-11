// A non-inverting op-amp stage with exact resistors, as `.vdsp` source text: input jack on the `+` input,
// `Rf` from output to `-`, `Rg` from `-` to ground, +-9 V rails. Its closed loop has a closed form
// (see `closedLoopMagnitudeDb`), which makes it a known answer that depends on neither ngspice nor any
// capture -- the control for "the declared gain-bandwidth product reaches the solver".

/** The class default open-loop gain a declared op-amp with no `Aol` gets (device-laws.ts). */
export const DEFAULT_OPEN_LOOP_GAIN = 1e5;

export type StageOptions = {
	readonly rfOhms: number;
	readonly rgOhms: number;
	/** A `GBP` property exactly as a packet would write it (string or number), or absent. */
	readonly gbp?: string | number;
	/** A `PartNumber` property, so the catalog's datasheet figure can be exercised. */
	readonly partNumber?: string;
	/** A declared `Aol`, linear; absent means the class default 1e5. */
	readonly aol?: number;
};

const yamlScalar = (value: string | number): string =>
	typeof value === "number" ? String(value) : JSON.stringify(value);

export function nonInvertingStage(options: StageOptions): string {
	const properties: string[] = [];
	if (options.partNumber !== undefined) {
		properties.push(`      PartNumber: ${JSON.stringify(options.partNumber)}`);
	}
	if (options.aol !== undefined) {
		properties.push(`      Aol: ${options.aol}`);
	}
	if (options.gbp !== undefined) {
		properties.push(`      GBP: ${yamlScalar(options.gbp)}`);
	}
	properties.push('      Description: "Non-inverting op-amp stage, exact resistors."');
	const resistor = (id: string, a: number, b: number, ohms: number) => `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: -20
      - name: b
        node: ${b}
        position:
          x: 0
          y: 20
    properties:
      Resistance: "${ohms}"
`;
	return `schema: circuit-interchange/v3
metadata:
  name: "Non-inverting stage"
  description: "Non-inverting op-amp stage with exact resistors."
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
    properties:
      Description: "Stage input."
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
    properties:
      Description: "Stage output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 100
    properties:
      Description: "Ground."
${resistor("RF", 2, 3, options.rfOhms)}${resistor("RG", 3, 0, options.rgOhms)}  - id: U1
    kind: opamp
    name: U1
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 1
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
    properties:
${properties.join("\n")}
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 9
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Positive rail."
  - id: V2
    kind: voltage-source
    name: SUPPLY_NEG
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 60
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 8
        position:
          x: 60
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 60
          y: -180
    properties:
      Voltage: "-9"
      Description: "Negative rail."
wires: []
`;
}

/**
 * The single-pole closed loop of a non-inverting stage, in dB, at `hz`.
 *
 * An op-amp `A(s) = A0 / (1 + s / wp)` with `wp = 2 pi GBP / A0` in a loop of feedback fraction
 * `1 / G` (`G = 1 + Rf / Rg`) gives
 *
 *   `Acl = (A0 / (1 + A0 / G)) / (1 + j f / fc)`,   `fc = GBP * (1 / A0 + 1 / G)`.
 *
 * **The A0 correction** is the two finite-gain terms against the ideal `G / (1 + j f G / GBP)`:
 * the DC gain is `G / (1 + G / A0)` rather than `G` (0.1 % for G = 100, A0 = 1e5), and the corner is
 * `GBP (1 / G + 1 / A0)` rather than `GBP / G` (also 0.1 %). Both are below the 0.05 dB bar but are
 * included so the known answer is exact rather than approximate.
 */
export function closedLoopMagnitudeDb(
	gain: number,
	gbpHz: number,
	hz: number,
	aol: number = DEFAULT_OPEN_LOOP_GAIN,
): number {
	const dc = gain / (1 + gain / aol);
	const corner = gbpHz * (1 / aol + 1 / gain);
	return 20 * Math.log10(dc / Math.sqrt(1 + (hz / corner) ** 2));
}

/**
 * The same stage's closed loop under the engine's own pole law, in dB, at `hz`, for an engine running its
 * solver at `solverRate` hertz (the host rate times the oversample factor).
 *
 * `opAmpPoleAlpha` discretises the open-loop pole with backward Euler: `alpha = dt / (dt + tau)`,
 * `tau = A0 / (2 pi GBP)`, and the raw state is `v[n] = alpha A0 d[n] + (1 - alpha) v[n-1]`. With the
 * differential `d = vin - v / G` that is the one-pole filter
 *
 *   `H(z) = K / (1 - a z^-1)`,  `K = alpha A0 / (1 + alpha A0 / G)`,  `a = (1 - alpha) / (1 + alpha A0 / G)`,
 *
 * whose magnitude departs from the continuous closed form by about `w^2 tau_c dt`. This is what the
 * consoles are *specified* to compute, so it is the known answer for "the declared product reaches the
 * solver". It is NOT the accuracy bar: against `closedLoopMagnitudeDb` the engine is low by up to 0.8 dB
 * at 16 kHz for a gain-100 stage at 192 kHz, which is the backward-Euler pole's own error.
 */
export function beClosedLoopMagnitudeDb(
	gain: number,
	gbpHz: number,
	hz: number,
	solverRate: number,
	aol: number = DEFAULT_OPEN_LOOP_GAIN,
): number {
	const dt = 1 / solverRate;
	const tau = aol / (2 * Math.PI * gbpHz);
	const alpha = dt / (dt + tau);
	const beta = 1 / gain;
	const k = (alpha * aol) / (1 + alpha * aol * beta);
	const a = (1 - alpha) / (1 + alpha * aol * beta);
	const theta = (2 * Math.PI * hz) / solverRate;
	return 20 * Math.log10(k / Math.hypot(1 - a * Math.cos(theta), a * Math.sin(theta)));
}
