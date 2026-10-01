import { describe, expect, test } from "bun:test";
import { CabinetIrNode } from "@vessel-dsp/chain";

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function naiveConvolution(input: Float64Array, ir: Float64Array): Float64Array {
	const out = new Float64Array(input.length);
	for (let n = 0; n < input.length; n++) {
		let sum = 0;
		const jMax = Math.min(n, ir.length - 1);
		for (let j = 0; j <= jMax; j++) {
			sum += (ir[j] ?? 0) * (input[n - j] ?? 0);
		}
		out[n] = sum;
	}
	return out;
}

function splitIntoBlocks(total: number, pattern: readonly number[]): number[] {
	const sizes: number[] = [];
	let remaining = total;
	let i = 0;
	while (remaining > 0) {
		const size = Math.min(pattern[i % pattern.length] ?? remaining, remaining);
		sizes.push(size);
		remaining -= size;
		i += 1;
	}
	return sizes;
}

describe("CabinetIrNode partitioned convolution", () => {
	test("matches naive direct convolution for many IR lengths and block sizes", () => {
		const irLengths = [1, 127, 128, 129, 1000, 5000];
		const blockPattern = [1, 7, 128, 300, 53, 200, 64];

		for (const irLen of irLengths) {
			const rng = mulberry32(1000 + irLen);
			const ir = new Float64Array(irLen);
			for (let i = 0; i < irLen; i++) {
				ir[i] = (rng() * 2 - 1) * Math.exp(-i / (irLen / 4 + 1));
			}
			const inputLen = 4000;
			const input = new Float64Array(inputLen);
			const rngIn = mulberry32(777 + irLen);
			for (let i = 0; i < inputLen; i++) {
				input[i] = rngIn() * 2 - 1;
			}

			const node = new CabinetIrNode(`cab-${irLen}`, `Cab ${irLen}`, { ir });
			node.prepare(48000);

			const sizes = splitIntoBlocks(inputLen, blockPattern);
			const outParts: Float64Array[] = [];
			let offset = 0;
			for (const size of sizes) {
				const chunk = input.slice(offset, offset + size);
				outParts.push(node.process(chunk));
				offset += size;
			}
			const actual = new Float64Array(inputLen);
			let pos = 0;
			for (const part of outParts) {
				actual.set(part, pos);
				pos += part.length;
			}

			const expected = naiveConvolution(input, ir);
			let maxDiff = 0;
			for (let i = 0; i < inputLen; i++) {
				maxDiff = Math.max(
					maxDiff,
					Math.abs((actual[i] ?? 0) - (expected[i] ?? 0)),
				);
			}
			expect(maxDiff).toBeLessThanOrEqual(1e-9);
		}
	});

	test("latency is zero: impulse in gives the IR out starting at sample 0", () => {
		const rng = mulberry32(42);
		const irLen = 512;
		const ir = new Float64Array(irLen);
		for (let i = 0; i < irLen; i++) {
			ir[i] = (rng() * 2 - 1) * Math.exp(-i / 64);
		}
		const node = new CabinetIrNode("cab-latency", "Latency", { ir });
		node.prepare(48000);

		const total = 512;
		const impulse = new Float64Array(total);
		impulse[0] = 1.0;
		const sizes = splitIntoBlocks(total, [128, 128, 128, 128]);
		const parts: Float64Array[] = [];
		let offset = 0;
		for (const size of sizes) {
			parts.push(node.process(impulse.slice(offset, offset + size)));
			offset += size;
		}
		const out = new Float64Array(total);
		let pos = 0;
		for (const part of parts) {
			out.set(part, pos);
			pos += part.length;
		}
		for (let i = 0; i < irLen; i++) {
			expect(Math.abs((out[i] ?? 0) - (ir[i] ?? 0))).toBeLessThanOrEqual(1e-9);
		}
		expect(out[0]).toBeCloseTo(ir[0] ?? 0, 12);
	});

	test("default filters are transparent for a unit IR; cuts change the output", () => {
		const rng = mulberry32(9);
		const len = 512;
		const input = new Float64Array(len);
		for (let i = 0; i < len; i++) {
			input[i] =
				Math.sin((2 * Math.PI * 100 * i) / 48000) * 0.5 + (rng() - 0.5) * 0.01;
		}

		const transparent = new CabinetIrNode("cab-flat", "Flat", { ir: [1] });
		transparent.prepare(48000);
		const flatOut = transparent.process(input);
		expect(flatOut.length).toBe(len);
		for (let i = 0; i < len; i++) {
			expect(flatOut[i]).toBe(input[i] ?? 0);
		}

		const lowCut = new CabinetIrNode("cab-hp", "Highpassed", {
			ir: [1],
			lowCutHz: 500,
		});
		lowCut.prepare(48000);
		const hpOut = lowCut.process(input);
		let hpDiff = 0;
		for (let i = 128; i < len; i++) {
			hpDiff = Math.max(hpDiff, Math.abs((hpOut[i] ?? 0) - (flatOut[i] ?? 0)));
		}
		expect(hpDiff).toBeGreaterThan(1e-3);

		const highCut = new CabinetIrNode("cab-lp", "Lowpassed", {
			ir: [1],
			highCutHz: 1000,
		});
		highCut.prepare(48000);
		const lpOut = highCut.process(input);
		let lpDiff = 0;
		for (let i = 128; i < len; i++) {
			lpDiff = Math.max(lpDiff, Math.abs((lpOut[i] ?? 0) - (flatOut[i] ?? 0)));
		}
		expect(lpDiff).toBeGreaterThan(1e-3);
	});

	test("48000-tap IR in 128-sample blocks is faster than 0.5x realtime", () => {
		const rng = mulberry32(1234);
		const irLen = 48000;
		const ir = new Float64Array(irLen);
		for (let i = 0; i < irLen; i++) {
			ir[i] = (rng() * 2 - 1) * Math.exp(-i / 8000);
		}
		const node = new CabinetIrNode("cab-big", "Big", { ir });
		node.prepare(48000);

		const total = 48000;
		const input = new Float64Array(total);
		for (let i = 0; i < total; i++) {
			input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
		}

		const start = performance.now();
		for (let offset = 0; offset < total; offset += 128) {
			node.process(input.slice(offset, offset + 128));
		}
		const elapsedMs = performance.now() - start;
		const audioMs = (total / 48000) * 1000;
		const realtimeFactor = audioMs / Math.max(elapsedMs, 1e-6);
		console.log(
			`48000-tap IR: ${elapsedMs.toFixed(1)} ms for 1 s audio (${realtimeFactor.toFixed(2)}x realtime)`,
		);
		expect(realtimeFactor).toBeGreaterThan(0.5);
	});

	test("irSampleRate 96000 prepared at 48000 gives about half the length", () => {
		const rng = mulberry32(555);
		const srcLen = 1000;
		const ir = new Float64Array(srcLen);
		for (let i = 0; i < srcLen; i++) {
			ir[i] = (rng() * 2 - 1) * Math.exp(-i / 200);
		}
		const node = new CabinetIrNode("cab-rs", "Resampled", {
			ir,
			irSampleRate: 96000,
		});
		node.prepare(48000);
		const effective = node.getIr();
		expect(effective.length).toBeGreaterThan(srcLen * 0.4);
		expect(effective.length).toBeLessThan(srcLen * 0.6);
		expect(
			Math.abs(effective.length - Math.round(srcLen / 2)),
		).toBeLessThanOrEqual(2);
	});
});
