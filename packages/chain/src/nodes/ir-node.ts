import type { ChainNode } from "../types.js";

export interface CabinetIrConfig {
	id?: string;
	name?: string;
	ir?: Float64Array | Float32Array | number[];
	lowCutHz?: number;
	highCutHz?: number;
	mix?: number;
	irSampleRate?: number;
}

const PARTITION_SIZE = 128;
const FFT_SIZE = PARTITION_SIZE * 2;

function fftInPlace(
	re: Float64Array,
	im: Float64Array,
	inverse: boolean,
): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) {
			j ^= bit;
		}
		j ^= bit;
		if (i < j) {
			const tmpRe = re[i] ?? 0;
			re[i] = re[j] ?? 0;
			re[j] = tmpRe;
			const tmpIm = im[i] ?? 0;
			im[i] = im[j] ?? 0;
			im[j] = tmpIm;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = ((inverse ? 2 : -2) * Math.PI) / len;
		const wlenRe = Math.cos(ang);
		const wlenIm = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let wRe = 1;
			let wIm = 0;
			for (let k = 0; k < len / 2; k++) {
				const uRe = re[i + k] ?? 0;
				const uIm = im[i + k] ?? 0;
				const vRe =
					(re[i + k + len / 2] ?? 0) * wRe - (im[i + k + len / 2] ?? 0) * wIm;
				const vIm =
					(re[i + k + len / 2] ?? 0) * wIm + (im[i + k + len / 2] ?? 0) * wRe;
				re[i + k] = uRe + vRe;
				im[i + k] = uIm + vIm;
				re[i + k + len / 2] = uRe - vRe;
				im[i + k + len / 2] = uIm - vIm;
				const nextRe = wRe * wlenRe - wIm * wlenIm;
				const nextIm = wRe * wlenIm + wIm * wlenRe;
				wRe = nextRe;
				wIm = nextIm;
			}
		}
	}
	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] = (re[i] ?? 0) / n;
			im[i] = (im[i] ?? 0) / n;
		}
	}
}

function spectrumOfBlock(block: Float64Array): {
	re: Float64Array;
	im: Float64Array;
} {
	const re = new Float64Array(FFT_SIZE);
	const im = new Float64Array(FFT_SIZE);
	for (let i = 0; i < PARTITION_SIZE; i++) {
		re[i] = block[i] ?? 0;
	}
	fftInPlace(re, im, false);
	return { re, im };
}

function resampleIrWindowedSinc(
	input: Float64Array,
	sourceRate: number,
	targetRate: number,
): Float64Array {
	if (!(sourceRate > 0) || !(targetRate > 0) || sourceRate === targetRate) {
		return new Float64Array(input);
	}
	const ratio = targetRate / sourceRate;
	const outLen = Math.max(1, Math.round(input.length * ratio));
	const cutoff = Math.min(1, ratio);
	const radius = Math.max(1, Math.ceil(16 / cutoff));
	const output = new Float64Array(outLen);
	for (let n = 0; n < outLen; n++) {
		const srcPos = n / ratio;
		const iCenter = Math.floor(srcPos);
		let sum = 0;
		for (let i = iCenter - radius; i <= iCenter + radius; i++) {
			if (i < 0 || i >= input.length) continue;
			const d = srcPos - i;
			if (Math.abs(d) > radius) continue;
			const xd = d * cutoff;
			const sinc = xd === 0 ? 1 : Math.sin(Math.PI * xd) / (Math.PI * xd);
			const hann = 0.5 * (1 + Math.cos((Math.PI * d) / radius));
			sum += (input[i] ?? 0) * cutoff * sinc * hann;
		}
		output[n] = sum;
	}
	return output;
}

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}

function lowpassCoeffs(
	cutoffHz: number,
	sampleRate: number,
): Pick<Biquad, "b0" | "b1" | "b2" | "a1" | "a2"> {
	const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
	const q = 1 / Math.SQRT2;
	const alpha = Math.sin(w0) / (2 * q);
	const cosw0 = Math.cos(w0);
	const b0 = (1 - cosw0) / 2;
	const b1 = 1 - cosw0;
	const b2 = (1 - cosw0) / 2;
	const a0 = 1 + alpha;
	return {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: (-2 * cosw0) / a0,
		a2: (1 - alpha) / a0,
	};
}

function highpassCoeffs(
	cutoffHz: number,
	sampleRate: number,
): Pick<Biquad, "b0" | "b1" | "b2" | "a1" | "a2"> {
	const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
	const q = 1 / Math.SQRT2;
	const alpha = Math.sin(w0) / (2 * q);
	const cosw0 = Math.cos(w0);
	const b0 = (1 + cosw0) / 2;
	const b1 = -(1 + cosw0);
	const b2 = (1 + cosw0) / 2;
	const a0 = 1 + alpha;
	return {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: (-2 * cosw0) / a0,
		a2: (1 - alpha) / a0,
	};
}

export class CabinetIrNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "cabinet-ir";
	bypassed = false;
	mix = 1.0;

	private sourceIr: Float64Array;
	private sourceRate: number | undefined;
	private ir: Float64Array;
	private direct: Float64Array = new Float64Array(0);
	private partitions: { re: Float64Array; im: Float64Array }[] = [];

	private sampleRate = 48000;
	private lowCutHz = 20;
	private highCutHz = 20000;

	private hp: Biquad = {
		b0: 1,
		b1: 0,
		b2: 0,
		a1: 0,
		a2: 0,
		x1: 0,
		x2: 0,
		y1: 0,
		y2: 0,
	};
	private lp: Biquad = {
		b0: 1,
		b1: 0,
		b2: 0,
		a1: 0,
		a2: 0,
		x1: 0,
		x2: 0,
		y1: 0,
		y2: 0,
	};
	private hpActive = false;
	private lpActive = false;

	private history = new Float64Array(PARTITION_SIZE);
	private historyPos = 0;
	private blockBuf = new Float64Array(PARTITION_SIZE);
	private globalPos = 0;
	private fdl: ({
		re: Float64Array;
		im: Float64Array;
		block: number;
	} | null)[] = [];
	private overlap = new Float64Array(PARTITION_SIZE);
	private tailBlockNum = -1;
	private tailBlock = new Float64Array(PARTITION_SIZE);
	private accumRe = new Float64Array(FFT_SIZE);
	private accumIm = new Float64Array(FFT_SIZE);

	constructor(id = "cab-ir", name = "Cabinet IR", config?: CabinetIrConfig) {
		this.id = id;
		this.name = name;
		if (config?.mix !== undefined)
			this.mix = Math.max(0, Math.min(1, config.mix));
		if (config?.lowCutHz !== undefined)
			this.lowCutHz = Math.max(20, Math.min(500, config.lowCutHz));
		if (config?.highCutHz !== undefined)
			this.highCutHz = Math.max(1000, Math.min(20000, config.highCutHz));
		if (config?.irSampleRate !== undefined)
			this.sourceRate = config.irSampleRate;

		if (config?.ir && config.ir.length > 0) {
			this.sourceIr = new Float64Array(config.ir);
			if (this.sourceRate === undefined) this.sourceRate = undefined;
		} else {
			// Synthetic placeholder IR, not a 4x12 capture. 128 samples at 48 kHz.
			this.sourceIr = this.generateDefaultCabinetIr();
			this.sourceRate = 48000;
		}

		this.ir = new Float64Array(this.sourceIr);
		this.rebuild();
		this.updateFilters();
	}

	setIr(
		irData: Float64Array | Float32Array | number[],
		irSampleRate?: number,
	): void {
		this.sourceIr = new Float64Array(irData);
		if (irSampleRate !== undefined) {
			this.sourceRate = irSampleRate;
		} else {
			this.sourceRate = undefined;
		}
		this.deriveEffectiveIr();
		this.rebuild();
		this.clearState();
	}

	getIr(): Float64Array {
		return new Float64Array(this.ir);
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.deriveEffectiveIr();
		this.rebuild();
		this.updateFilters();
		this.clearState();
	}

	reset(): void {
		this.clearState();
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "lowCutHz":
				return this.lowCutHz;
			case "highCutHz":
				return this.highCutHz;
			case "mix":
				return this.mix;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "lowCutHz":
				this.lowCutHz = Math.max(20, Math.min(500, value));
				this.updateFilters();
				break;
			case "highCutHz":
				this.highCutHz = Math.max(1000, Math.min(20000, value));
				this.updateFilters();
				break;
			case "mix":
				this.mix = Math.max(0, Math.min(1, value));
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			lowCutHz: this.lowCutHz,
			highCutHz: this.highCutHz,
			mix: this.mix,
		};
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const output = new Float64Array(length);
		const directLen = this.direct.length;

		if (this.bypassed || this.ir.length === 0) {
			for (let i = 0; i < length; i++) {
				output[i] = input[i] ?? 0;
			}
			return output;
		}

		const useMix = this.mix < 1;
		const dryMix = 1 - this.mix;

		for (let i = 0; i < length; i++) {
			const x = input[i] ?? 0;
			const m = Math.floor(this.globalPos / PARTITION_SIZE);
			const o = this.globalPos - m * PARTITION_SIZE;
			if (m !== this.tailBlockNum) {
				this.computeTailBlock(m);
			}
			this.history[this.historyPos] = x;
			let wet = this.tailBlock[o] ?? 0;
			for (let j = 0; j < directLen; j++) {
				wet +=
					(this.direct[j] ?? 0) *
					(this.history[
						(this.historyPos - j + PARTITION_SIZE * 2) % PARTITION_SIZE
					] ?? 0);
			}
			this.historyPos = (this.historyPos + 1) % PARTITION_SIZE;

			let shaped = wet;
			if (this.hpActive) {
				const y =
					this.hp.b0 * shaped +
					this.hp.b1 * this.hp.x1 +
					this.hp.b2 * this.hp.x2 -
					this.hp.a1 * this.hp.y1 -
					this.hp.a2 * this.hp.y2;
				this.hp.x2 = this.hp.x1;
				this.hp.x1 = shaped;
				this.hp.y2 = this.hp.y1;
				this.hp.y1 = y;
				shaped = y;
			}
			if (this.lpActive) {
				const y =
					this.lp.b0 * shaped +
					this.lp.b1 * this.lp.x1 +
					this.lp.b2 * this.lp.x2 -
					this.lp.a1 * this.lp.y1 -
					this.lp.a2 * this.lp.y2;
				this.lp.x2 = this.lp.x1;
				this.lp.x1 = shaped;
				this.lp.y2 = this.lp.y1;
				this.lp.y1 = y;
				shaped = y;
			}

			output[i] = useMix ? this.mix * shaped + dryMix * x : shaped;
			if (this.mix <= 0) {
				output[i] = x;
			}

			this.blockBuf[o] = x;
			this.globalPos += 1;
			if (o === PARTITION_SIZE - 1) {
				this.storeCompletedBlock(m);
			}
		}

		return output;
	}

	private computeTailBlock(m: number): void {
		const kCount = this.partitions.length;
		if (kCount === 0) {
			this.tailBlock.fill(0);
			this.tailBlockNum = m;
			return;
		}
		this.accumRe.fill(0);
		this.accumIm.fill(0);
		for (let k = 0; k < kCount; k++) {
			const idx = m - 1 - k;
			if (idx < 0) continue;
			const entry = this.fdl[idx % kCount];
			if (!entry || entry.block !== idx) continue;
			const h = this.partitions[k];
			if (!h) continue;
			const hRe = h.re;
			const hIm = h.im;
			const xRe = entry.re;
			const xIm = entry.im;
			for (let b = 0; b < FFT_SIZE; b++) {
				const xr = xRe[b] ?? 0;
				const xi = xIm[b] ?? 0;
				const hr = hRe[b] ?? 0;
				const hi = hIm[b] ?? 0;
				this.accumRe[b] = (this.accumRe[b] ?? 0) + xr * hr - xi * hi;
				this.accumIm[b] = (this.accumIm[b] ?? 0) + xr * hi + xi * hr;
			}
		}
		fftInPlace(this.accumRe, this.accumIm, true);
		for (let i = 0; i < PARTITION_SIZE; i++) {
			this.tailBlock[i] = (this.accumRe[i] ?? 0) + (this.overlap[i] ?? 0);
		}
		for (let i = 0; i < PARTITION_SIZE; i++) {
			this.overlap[i] = this.accumRe[PARTITION_SIZE + i] ?? 0;
		}
		this.tailBlockNum = m;
	}

	private storeCompletedBlock(m: number): void {
		const kCount = this.partitions.length;
		if (kCount === 0) return;
		const spec = spectrumOfBlock(this.blockBuf);
		const slot = m % kCount;
		this.fdl[slot] = { re: spec.re, im: spec.im, block: m };
	}

	private deriveEffectiveIr(): void {
		if (this.sourceRate !== undefined && this.sourceRate !== this.sampleRate) {
			this.ir = resampleIrWindowedSinc(
				this.sourceIr,
				this.sourceRate,
				this.sampleRate,
			);
		} else {
			this.ir = new Float64Array(this.sourceIr);
		}
	}

	private rebuild(): void {
		const len = this.ir.length;
		const directLen = Math.min(PARTITION_SIZE, len);
		this.direct = new Float64Array(directLen);
		for (let i = 0; i < directLen; i++) {
			this.direct[i] = this.ir[i] ?? 0;
		}
		this.partitions = [];
		if (len > PARTITION_SIZE) {
			const tailLen = len - PARTITION_SIZE;
			const kCount = Math.ceil(tailLen / PARTITION_SIZE);
			for (let k = 0; k < kCount; k++) {
				const re = new Float64Array(FFT_SIZE);
				const im = new Float64Array(FFT_SIZE);
				for (let i = 0; i < PARTITION_SIZE; i++) {
					const srcIdx = PARTITION_SIZE + k * PARTITION_SIZE + i;
					re[i] = srcIdx < len ? (this.ir[srcIdx] ?? 0) : 0;
				}
				fftInPlace(re, im, false);
				this.partitions.push({ re, im });
			}
		}
		const kCount = this.partitions.length;
		this.fdl = kCount > 0 ? new Array(kCount).fill(null) : [];
	}

	private updateFilters(): void {
		this.hpActive = this.lowCutHz > 20;
		this.lpActive = this.highCutHz < 20000;
		if (this.hpActive) {
			const c = highpassCoeffs(this.lowCutHz, this.sampleRate);
			this.hp.b0 = c.b0;
			this.hp.b1 = c.b1;
			this.hp.b2 = c.b2;
			this.hp.a1 = c.a1;
			this.hp.a2 = c.a2;
		}
		if (this.lpActive) {
			const c = lowpassCoeffs(this.highCutHz, this.sampleRate);
			this.lp.b0 = c.b0;
			this.lp.b1 = c.b1;
			this.lp.b2 = c.b2;
			this.lp.a1 = c.a1;
			this.lp.a2 = c.a2;
		}
	}

	private clearState(): void {
		this.history = new Float64Array(PARTITION_SIZE);
		this.historyPos = 0;
		this.blockBuf = new Float64Array(PARTITION_SIZE);
		this.globalPos = 0;
		this.overlap = new Float64Array(PARTITION_SIZE);
		this.tailBlock = new Float64Array(PARTITION_SIZE);
		this.tailBlockNum = -1;
		this.hp.x1 = 0;
		this.hp.x2 = 0;
		this.hp.y1 = 0;
		this.hp.y2 = 0;
		this.lp.x1 = 0;
		this.lp.x2 = 0;
		this.lp.y1 = 0;
		this.lp.y2 = 0;
		const kCount = this.partitions.length;
		this.fdl = kCount > 0 ? new Array(kCount).fill(null) : [];
	}

	private generateDefaultCabinetIr(): Float64Array {
		// Synthetic placeholder IR, not a 4x12 capture. 128 samples at 48 kHz.
		const len = 128;
		const ir = new Float64Array(len);
		const decay = 0.04;

		for (let i = 0; i < len; i++) {
			const t = i / 48000;
			const f1 = 110;
			const f2 = 3200;
			const env = Math.exp(-i * decay);
			ir[i] =
				env *
				(0.6 * Math.sin(2 * Math.PI * f1 * t) +
					0.4 * Math.sin(2 * Math.PI * f2 * t));
		}

		let maxVal = 0;
		for (let i = 0; i < len; i++) {
			maxVal = Math.max(maxVal, Math.abs(ir[i] ?? 0));
		}
		if (maxVal > 0) {
			for (let i = 0; i < len; i++) {
				ir[i] = (ir[i] ?? 0) / maxVal;
			}
		}

		return ir;
	}
}
