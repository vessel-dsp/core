import { describe, expect, test } from "bun:test";
import {
	AmpShaperNode,
	InputProfileNode,
	SignalChain,
} from "@vessel-dsp/chain";

describe("chain presets, cable resonance, and amp shaper mix", () => {
	test("preset round trip keeps guitarCableLengthMeters (10 m comes back as 10 m)", () => {
		const chain = new SignalChain({ sampleRate: 48000 });
		chain.inputProfile.setGuitarCableLength(10);
		const json = chain.toJson("Long Cable Rig");
		const restored = SignalChain.fromJson(json);
		expect(restored.inputProfile.getConfig().guitarCableLengthMeters).toBe(10);
		expect(restored.inputProfile.getParam("guitarCableLengthMeters")).toBe(10);
	});

	test("resonance falls as cable length rises (single-coil: 0 m > 3 m > 10 m)", () => {
		const at0 = new InputProfileNode({ pickupType: "single-coil" });
		at0.setGuitarCableLength(0);
		at0.prepare(48000);
		const at3 = new InputProfileNode({ pickupType: "single-coil" });
		at3.setGuitarCableLength(3);
		at3.prepare(48000);
		const at10 = new InputProfileNode({ pickupType: "single-coil" });
		at10.setGuitarCableLength(10);
		at10.prepare(48000);

		const f0 = at0.getParam("resonantFreqHz") ?? 0;
		const f3 = at3.getParam("resonantFreqHz") ?? 0;
		const f10 = at10.getParam("resonantFreqHz") ?? 0;
		expect(f0).toBeGreaterThan(f3);
		expect(f3).toBeGreaterThan(f10);
	});

	test("AmpShaperNode mix=0 equals the input; mix=1 equals the shaped signal", () => {
		const input = new Float64Array(256);
		for (let i = 0; i < input.length; i++) {
			input[i] = Math.sin((2 * Math.PI * 220 * i) / 48000) * 0.4;
		}

		const dry = new AmpShaperNode("amp-dry", "Amp", { gain: 2.0 });
		dry.mix = 0;
		dry.prepare(48000);
		const dryOut = dry.process(input);
		for (let i = 0; i < input.length; i++) {
			expect(dryOut[i]).toBe(input[i] ?? 0);
		}

		const wet = new AmpShaperNode("amp-wet", "Amp", { gain: 2.0 });
		wet.mix = 1;
		wet.prepare(48000);
		const wetOut = wet.process(input);
		let diff = 0;
		for (let i = 64; i < input.length; i++) {
			diff = Math.max(diff, Math.abs((wetOut[i] ?? 0) - (input[i] ?? 0)));
		}
		expect(diff).toBeGreaterThan(1e-3);

		const half = new AmpShaperNode("amp-half", "Amp", { gain: 2.0 });
		half.mix = 0.5;
		half.prepare(48000);
		const halfOut = half.process(input);
		for (let i = 64; i < input.length; i++) {
			const expected = 0.5 * (input[i] ?? 0) + 0.5 * (wetOut[i] ?? 0);
			expect(Math.abs((halfOut[i] ?? 0) - expected)).toBeLessThanOrEqual(1e-9);
		}
	});
});
