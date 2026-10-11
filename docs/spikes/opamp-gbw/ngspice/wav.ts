import { readFileSync, writeFileSync } from "node:fs";

export type PcmWav = {
	readonly samples: Float64Array;
	readonly sampleRate: number;
	readonly channels: number;
	readonly bitsPerSample: number;
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = "";
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(bytes[offset + index] ?? 0);
	}
	return value;
}

function sampleAt(
	bytes: Uint8Array,
	offset: number,
	bitsPerSample: number,
): number {
	if (bitsPerSample === 8) return ((bytes[offset] ?? 128) - 128) / 128;
	if (bitsPerSample === 16) {
		const value = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
		return (value & 0x8000 ? value - 0x10000 : value) / 32768;
	}
	if (bitsPerSample === 24) {
		let value =
			(bytes[offset] ?? 0) |
			((bytes[offset + 1] ?? 0) << 8) |
			((bytes[offset + 2] ?? 0) << 16);
		if ((value & 0x800000) !== 0) value |= 0xff000000;
		return value / 8388608;
	}
	if (bitsPerSample === 32) {
		const value =
			((bytes[offset] ?? 0) |
				((bytes[offset + 1] ?? 0) << 8) |
				((bytes[offset + 2] ?? 0) << 16) |
				((bytes[offset + 3] ?? 0) << 24)) |
			0;
		return (value & 0x80000000 ? value - 0x100000000 : value) / 2147483648;
	}
	throw new Error(`Unsupported PCM width ${bitsPerSample}`);
}

export function decodePcmWav(bytes: Uint8Array): PcmWav {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
		throw new Error("Expected RIFF/WAVE input");
	}
	let audioFormat: number | null = null;
	let channels: number | null = null;
	let sampleRate: number | null = null;
	let blockAlign: number | null = null;
	let bitsPerSample: number | null = null;
	let dataOffset: number | null = null;
	let dataLength: number | null = null;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const chunk = ascii(bytes, offset, 4);
		const size = view.getUint32(offset + 4, true);
		const data = offset + 8;
		if (data + size > bytes.byteLength) throw new Error("WAV chunk exceeds file length");
		if (chunk === "fmt " && size >= 16) {
			audioFormat = view.getUint16(data, true);
			channels = view.getUint16(data + 2, true);
			sampleRate = view.getUint32(data + 4, true);
			blockAlign = view.getUint16(data + 12, true);
			bitsPerSample = view.getUint16(data + 14, true);
		}
		if (chunk === "data") {
			dataOffset = data;
			dataLength = size;
		}
		offset = data + size + (size % 2);
	}
	if (
		audioFormat !== 1 ||
		channels === null ||
		channels < 1 ||
		sampleRate === null ||
		sampleRate <= 0 ||
		blockAlign === null ||
		bitsPerSample === null ||
		!([8, 16, 24, 32] as readonly number[]).includes(bitsPerSample) ||
		dataOffset === null ||
		dataLength === null
	) {
		throw new Error("WAV must contain PCM samples with a supported format");
	}
	const bytesPerSample = bitsPerSample / 8;
	if (blockAlign !== bytesPerSample * channels || dataLength < blockAlign) {
		throw new Error("WAV has an invalid block alignment or data length");
	}
	const frameCount = Math.floor(dataLength / blockAlign);
	const samples = new Float64Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		samples[frame] = sampleAt(bytes, dataOffset + frame * blockAlign, bitsPerSample);
	}
	return { samples, sampleRate, channels, bitsPerSample };
}

export function readPcmWav(path: string): PcmWav {
	return decodePcmWav(readFileSync(path));
}

export function resampleLinear(
	samples: Readonly<Float64Array>,
	sourceRate: number,
	targetRate: number,
): Float64Array {
	if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
		throw new Error("sample rates must be positive");
	}
	if (samples.length === 0) return new Float64Array(0);
	const length = Math.max(
		1,
		Math.round(((samples.length - 1) * targetRate) / sourceRate) + 1,
	);
	const result = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		const position = (index * sourceRate) / targetRate;
		const left = Math.floor(position);
		const right = Math.min(samples.length - 1, left + 1);
		const fraction = position - left;
		result[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
	}
	return result;
}

function pwlNumber(value: number): string {
	return Number(value.toPrecision(12)).toString();
}

export function writeFloatWav(
	path: string,
	samples: Readonly<Float64Array> | readonly number[],
	sampleRate: number,
): void {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("WAV sample rate must be positive");
	for (const sample of samples) {
		if (!Number.isFinite(sample)) throw new Error("WAV output contains a non-finite sample");
	}
	const dataBytes = samples.length * 4;
	const bytes = Buffer.alloc(44 + dataBytes);
	bytes.write("RIFF", 0, "ascii");
	bytes.writeUInt32LE(36 + dataBytes, 4);
	bytes.write("WAVE", 8, "ascii");
	bytes.write("fmt ", 12, "ascii");
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(3, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(sampleRate, 24);
	bytes.writeUInt32LE(sampleRate * 4, 28);
	bytes.writeUInt16LE(4, 32);
	bytes.writeUInt16LE(32, 34);
	bytes.write("data", 36, "ascii");
	bytes.writeUInt32LE(dataBytes, 40);
	samples.forEach((sample, index) => bytes.writeFloatLE(sample, 44 + index * 4));
	writeFileSync(path, bytes);
}

export function pwlVoltageSource(
	name: string,
	node: string,
	samples: Readonly<Float64Array> | readonly number[],
	sampleRate: number,
): string[] {
	if (samples.length === 0) throw new Error("PWL source needs at least one sample");
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("PWL sample rate must be positive");
	const first = samples[0] ?? 0;
	if (!Number.isFinite(first)) throw new Error("PWL source contains a non-finite sample");
	const lines = [`${name} ${node} 0 PWL(0 ${pwlNumber(first)}`];
	for (let index = 1; index < samples.length; index += 1) {
		const value = samples[index] ?? 0;
		if (!Number.isFinite(value)) throw new Error("PWL source contains a non-finite sample");
		lines.push(`+ ${pwlNumber(index / sampleRate)} ${pwlNumber(value)}`);
	}
	lines.push(")");
	return lines;
}
