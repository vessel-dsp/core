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

	test("SignalChain supports node insertion, reordering, and moving", () => {
		const chain = new SignalChain({ sampleRate: 48000 });
		const n1 = new GainNode("node-1", "Boost 1");
		const n2 = new GainNode("node-2", "Boost 2");
		const n3 = new GainNode("node-3", "Boost 3");

		chain.addNode(n1);
		chain.addNode(n3);
		expect(chain.length).toBe(2);

		// Insert n2 at index 1
		chain.insertNode(n2, 1);
		expect(chain.getEffectNodes().map((n) => n.id)).toEqual(["node-1", "node-2", "node-3"]);

		// Move node-3 to the front
		chain.moveNode("node-3", 0);
		expect(chain.getEffectNodes().map((n) => n.id)).toEqual(["node-3", "node-1", "node-2"]);

		// Reorder explicitly
		chain.reorderNodes(["node-2", "node-3", "node-1"]);
		expect(chain.getEffectNodes().map((n) => n.id)).toEqual(["node-2", "node-3", "node-1"]);

		// Clear nodes
		chain.clearNodes();
		expect(chain.length).toBe(0);
	});

	test("SignalChain serializes and deserializes from JSON preset", () => {
		const chain = new SignalChain({ sampleRate: 48000 });
		chain.inputProfile.setPickupType("humbucker");
		chain.inputProfile.setInputGainDb(4);
		chain.addNode(new GainNode("boost", "Clean Boost", 12));
		chain.addNode(new NamNode("amp", "JCM800"));
		chain.addNode(new CabinetIrNode("cab", "4x12 Greenback"));

		const json = chain.toJson("Classic Rock Rig");
		expect(json).toContain("Classic Rock Rig");
		expect(json).toContain("humbucker");

		const restored = SignalChain.fromJson(json);
		expect(restored.inputProfile.getConfig().pickupType).toBe("humbucker");
		expect(restored.inputProfile.getConfig().inputGainDb).toBe(4);
		expect(restored.length).toBe(3);
		expect(restored.getNode("boost")).toBeDefined();
		expect(restored.getNode("amp")).toBeDefined();
		expect(restored.getNode("cab")).toBeDefined();
	});
});
