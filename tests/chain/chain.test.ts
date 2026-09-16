import { describe, expect, test } from "bun:test";
import {
	CabinetIrNode,
	GainNode,
	InputProfileNode,
	MasterNode,
	NamNode,
	SignalChain,
} from "@vessel-dsp/chain";

describe("Phase 2: Signal Chain Engine", () => {
	test("InputProfileNode shapes frequency response based on pickup type", () => {
		const singleCoil = new InputProfileNode({ pickupType: "single-coil" });
		const humbucker = new InputProfileNode({ pickupType: "humbucker" });

		singleCoil.prepare(48000);
		humbucker.prepare(48000);

		const impulse = new Float64Array(128);
		impulse[0] = 1.0;

		const outSc = singleCoil.process(impulse);
		const outHb = humbucker.process(impulse);

		expect(outSc.length).toBe(128);
		expect(outHb.length).toBe(128);
		// Different resonant characteristics
		expect(outSc[1]).not.toEqual(outHb[1]);
	});

	test("CabinetIrNode convolves input signal with impulse response", () => {
		const cab = new CabinetIrNode("test-cab", "4x12 V30");
		cab.prepare(48000);

		const impulse = new Float64Array(64);
		impulse[0] = 1.0;

		const out = cab.process(impulse);
		expect(out.length).toBe(64);
		expect(out.some((val) => Math.abs(val) > 0)).toBe(true);
	});

	test("MasterNode controls volume, mute, and safety limiter", () => {
		const master = new MasterNode({ volumeDb: 0, limiter: true });
		master.prepare(48000);

		// Overshoot input to test limiter
		const loudInput = new Float64Array(32).fill(5.0);
		const limitedOut = master.process(loudInput);

		for (let i = 0; i < 32; i++) {
			expect(limitedOut[i]).toBeLessThanOrEqual(1.05);
		}

		// Test mute
		master.setMuted(true);
		const mutedOut = master.process(loudInput);
		for (let i = 0; i < 32; i++) {
			expect(mutedOut[i]).toBe(0);
		}
	});

	test("SignalChain chains nodes, manages bypass, and serializes presets", () => {
		const chain = new SignalChain({ sampleRate: 48000 });
		const gain = new GainNode("gain-1", "Boost", 6);
		const nam = new NamNode("nam-1", "Amp");

		chain.addNode(gain);
		chain.addNode(nam);

		const input = new Float64Array(32).fill(0.1);
		const activeOut = chain.process(input);

		gain.bypassed = true;
		const bypassedOut = chain.process(input);

		expect(activeOut[0]).not.toEqual(bypassedOut[0]);

		const preset = chain.getPreset("Lead Solo");
		expect(preset.name).toBe("Lead Solo");
		expect(preset.nodes.find((n) => n.id === "gain-1")?.bypassed).toBe(true);
	});
});
