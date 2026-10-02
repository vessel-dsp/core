// Windowed-sinc IR resampler shared by chain and player.
//
// Moved here from packages/chain/src/nodes/ir-node.ts without changing the
// numerics. The player needs the same rate conversion without constructing a
// CabinetIrNode, so the function lives in this module and the node imports it.
// The loop below is intentionally unchanged from the original.

export function resampleImpulseResponse(
	ir: Float64Array,
	fromRate: number,
	toRate: number,
): Float64Array {
	if (!(fromRate > 0) || !(toRate > 0)) {
		throw new RangeError(
			`resampleImpulseResponse requires positive rates, got fromRate=${String(fromRate)} toRate=${String(toRate)}`,
		);
	}
	if (ir.length === 0) {
		throw new RangeError("resampleImpulseResponse requires a non-empty IR");
	}
	if (fromRate === toRate) {
		return new Float64Array(ir);
	}
	const ratio = toRate / fromRate;
	const outLen = Math.max(1, Math.round(ir.length * ratio));
	const cutoff = Math.min(1, ratio);
	const radius = Math.max(1, Math.ceil(16 / cutoff));
	const output = new Float64Array(outLen);
	for (let n = 0; n < outLen; n++) {
		const srcPos = n / ratio;
		const iCenter = Math.floor(srcPos);
		let sum = 0;
		for (let i = iCenter - radius; i <= iCenter + radius; i++) {
			if (i < 0 || i >= ir.length) continue;
			const d = srcPos - i;
			if (Math.abs(d) > radius) continue;
			const xd = d * cutoff;
			const sinc = xd === 0 ? 1 : Math.sin(Math.PI * xd) / (Math.PI * xd);
			const hann = 0.5 * (1 + Math.cos((Math.PI * d) / radius));
			sum += (ir[i] ?? 0) * cutoff * sinc * hann;
		}
		output[n] = sum;
	}
	return output;
}
