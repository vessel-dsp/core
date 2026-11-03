// Temperature parity: the folded engine against ngspice at 19 C and 25 C.
//
// Registered-first expectations (hand-computed closed forms and the measured
// bars, not implementation outputs):
// - thermistorDivider driven with DC 1.0 settles to R2/(R1(T)+R2): 0.5 at 25 C,
//   0.43239483463713957 at 19 C (R1 = 10k * exp(3950 * (1/292.15 - 1/298.15))).
// - thermalFuzzFacePair (two AC128 germanium PNPs, RT1 = 33k NTC Beta 3950 in
//   Q1's collector return) renders within the compiler's existing parity bars
//   against a hand-written ngspice deck at both temperatures: correlation at
//   least 0.9999 and every-sample delta below 1e-4 on the settled last cycle,
//   DC within 1e-4. The deck carries the same numbers the compiler folds --
//   `.options temp=<C> tnom=26.85`, `.model ... EG=0.67 XTI=3`, and RT1 as the
//   folded resistance with its R_ref/Beta/T comment -- so ngspice reproduces the
//   fold rather than re-deriving it.
// - With no ngspice binary the ngspice legs skip; the runtime closed-form legs
//   always run.

import { afterAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import { thermalFuzzFacePair, thermistorDivider } from "@vessel-dsp/compiler/fixtures";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const SAMPLE_RATE = 48000;
const CYCLES = 480;
const DRIVE_VOLTS = 0.005;
const DRIVE_HZ = 1000;

const NGSPICE = Bun.which("ngspice");
const scratch = NGSPICE === null ? null : mkdtempSync(join(tmpdir(), "vdsp-temp-parity-"));
afterAll(() => {
	if (scratch !== null) {
		rmSync(scratch, { recursive: true, force: true });
	}
});

function deckFor(tempC: 19 | 25, rthOhms: number): string {
	return `* Thermal Fuzz Face pair parity fixture at ${tempC} C
* RT1 = R_ref * exp(Beta * (1/T - 1/T_ref)): R_ref=33k Beta=3950 T_ref=25C T=${tempC}C
.options temp=${tempC} tnom=26.85
V1 5 0 DC 9
VIN 1 0 SIN(0 ${DRIVE_VOLTS} ${DRIVE_HZ})
CIN 1 2 10u
RB1 5 2 10k
RB2 2 0 100k
Q1 3 2 4 QAC128
RE1 4 5 4.7k
RTH 3 5 ${rthOhms}
C2 3 7 10u
RB3 5 7 10k
RB4 7 0 100k
Q2 6 7 8 QAC128
RE2 8 5 4.7k
RC2 6 0 10k
.model QAC128 PNP(IS=17e-6 BF=90 BR=1 EG=0.67 XTI=3)
.tran 20.8333u 10m 0 20.8333u
.print tran v(6)
.end
`;
}

const DECK_19C = deckFor(19, 43319.13555973257);
const DECK_25C = deckFor(25, 33000);

function parseNgspiceTran(output: string): Array<{ time: number; volts: number }> {
	const rows: Array<{ time: number; volts: number }> = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*\d+\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*$/);
		if (match !== null && match[1] !== undefined && match[2] !== undefined) {
			rows.push({ time: Number(match[1]), volts: Number(match[2]) });
		}
	}
	return rows;
}

function interpolate(rows: Array<{ time: number; volts: number }>, time: number): number {
	let low = 0;
	let high = rows.length - 1;
	while (low < high) {
		const mid = (low + high) >> 1;
		if ((rows[mid]?.time ?? 0) < time) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	if (low <= 0) return rows[0]?.volts ?? 0;
	if (low >= rows.length) return rows[rows.length - 1]?.volts ?? 0;
	const before = rows[low - 1];
	const after = rows[low];
	if (before === undefined || after === undefined || after.time === before.time) {
		return after?.volts ?? 0;
	}
	const fraction = (time - before.time) / (after.time - before.time);
	return before.volts + fraction * (after.volts - before.volts);
}

function renderRuntime(tempC: number): Float64Array {
	const result = compile(thermalFuzzFacePair, {
		registry: pedalPartCatalog,
		ambientTemperatureC: tempC,
	});
	if (result.status !== "ok") {
		throw new Error(`fixture did not compile at ${tempC} C: ${JSON.stringify(result)}`);
	}
	const runtime = new ReferenceRuntime(result.program);
	runtime.prepare(SAMPLE_RATE);
	const input = new Float64Array(CYCLES);
	for (let index = 0; index < CYCLES; index += 1) {
		input[index] = DRIVE_VOLTS * Math.sin((2 * Math.PI * DRIVE_HZ * index) / SAMPLE_RATE);
	}
	return runtime.process(input);
}

function parity(tempC: 19 | 25, deck: string): { correlation: number; maxDelta: number; dcDelta: number } {
	if (scratch === null || NGSPICE === null) {
		throw new Error("ngspice unavailable");
	}
	const deckPath = join(scratch, `ff${tempC}.cir`);
	const outPath = join(scratch, `ff${tempC}.out`);
	writeFileSync(deckPath, deck);
	const run = Bun.spawnSync([NGSPICE, "-b", "-o", outPath, deckPath]);
	if (run.exitCode !== 0) {
		throw new Error(`ngspice failed at ${tempC} C: ${run.stderr.toString().slice(0, 500)}`);
	}
	const rows = parseNgspiceTran(readFileSync(outPath, "utf8"));
	expect(rows.length).toBeGreaterThan(400);
	const runtime = renderRuntime(tempC);
	// The settled last cycle only: samples 432..479 (t = 9..10 ms).
	const start = CYCLES - 48;
	const ng: number[] = [];
	const rt: number[] = [];
	for (let index = start; index < CYCLES; index += 1) {
		ng.push(interpolate(rows, index / SAMPLE_RATE));
		rt.push(runtime[index] ?? 0);
	}
	const meanNg = ng.reduce((sum, value) => sum + value, 0) / ng.length;
	const meanRt = rt.reduce((sum, value) => sum + value, 0) / rt.length;
	const covariance =
		ng.reduce((sum, value, index) => sum + (value - meanNg) * ((rt[index] ?? 0) - meanRt), 0) /
		ng.length;
	const varianceNg =
		ng.reduce((sum, value) => sum + (value - meanNg) ** 2, 0) / ng.length;
	const varianceRt =
		rt.reduce((sum, value) => sum + (value - meanRt) ** 2, 0) / rt.length;
	const correlation = covariance / Math.sqrt(varianceNg * varianceRt);
	const maxDelta = Math.max(...ng.map((value, index) => Math.abs(value - (rt[index] ?? 0))));
	return { correlation, maxDelta, dcDelta: Math.abs(meanNg - meanRt) };
}

describe("temperature parity", () => {
	it("settles the thermistor divider to the closed form at 19 C and 25 C", () => {
		for (const [tempC, expected] of [
			[19, 0.43239483463713957],
			[25, 0.5],
		] as const) {
			const result = compile(thermistorDivider, { ambientTemperatureC: tempC });
			expect(result.status).toBe("ok");
			if (result.status !== "ok") continue;
			const runtime = new ReferenceRuntime(result.program);
			runtime.prepare(SAMPLE_RATE);
			const output = runtime.process(new Float64Array(64).fill(1.0));
			const settled = output[output.length - 1] ?? 0;
			expect(Math.abs(settled - expected) / expected).toBeLessThan(1e-6);
		}
	});

	it("pins the deck emitter contract: temp/tnom, EG/XTI and the folded RT1", () => {
		// No deck emitter lives in this repo; the workbench source-to-spice deck
		// emits these lines for parity off-reference. The deck below is the
		// contract, asserted as text so a drift in either number fails loudly.
		expect(DECK_19C).toContain(".options temp=19 tnom=26.85");
		expect(DECK_25C).toContain(".options temp=25 tnom=26.85");
		expect(DECK_19C).toContain(".model QAC128 PNP(IS=17e-6 BF=90 BR=1 EG=0.67 XTI=3)");
		expect(DECK_19C).toContain("RTH 3 5 43319.13555973257");
		expect(DECK_25C).toContain("RTH 3 5 33000");
		expect(DECK_19C).toContain("R_ref=33k Beta=3950");
	});

	test.skipIf(NGSPICE === null)("agrees with ngspice at 19 C within the parity bars", () => {
		const { correlation, maxDelta, dcDelta } = parity(19, DECK_19C);
		expect(correlation).toBeGreaterThanOrEqual(0.9999);
		expect(maxDelta).toBeLessThan(1e-4);
		expect(dcDelta).toBeLessThan(1e-4);
	});

	test.skipIf(NGSPICE === null)("agrees with ngspice at 25 C within the parity bars", () => {
		const { correlation, maxDelta, dcDelta } = parity(25, DECK_25C);
		expect(correlation).toBeGreaterThanOrEqual(0.9999);
		expect(maxDelta).toBeLessThan(1e-4);
		expect(dcDelta).toBeLessThan(1e-4);
	});
});
