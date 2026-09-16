import type { Program } from "@vessel-dsp/compiler";
import {
	ChainRuntime,
	type ChainAdvisory,
	type ChainSlot,
	chainAdvisories,
	programSlot,
	slotContract,
} from "@vessel-dsp/runtime";
import type { PlayerSlot, SignalChain } from "./types";

export class ChainPlayer {
	private readonly sampleRate: number;
	private runtime: ChainRuntime | null = null;
	private chain: SignalChain = { slots: [] };

	constructor(sampleRate: number = 44100) {
		this.sampleRate = sampleRate;
	}

	public loadChain(chain: SignalChain): readonly ChainAdvisory[] {
		this.chain = chain;
		const slots: ChainSlot[] = [];

		for (const slot of chain.slots) {
			if (slot.program) {
				slots.push(programSlot(slot.program));
			}
		}

		if (slots.length > 0) {
			this.runtime = new ChainRuntime(slots);
			this.runtime.prepare(this.sampleRate);
		} else {
			this.runtime = null;
		}

		const contracts = slots.map((s) => slotContract(s));
		return chainAdvisories(contracts);
	}

	public process(input: Float64Array): Float64Array {
		if (!this.runtime) {
			return new Float64Array(input);
		}
		return this.runtime.process(input);
	}
}
