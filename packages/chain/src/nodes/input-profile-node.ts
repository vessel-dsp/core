import type { ChainNode, InputProfileConfig, PickupType } from "../types.js";

const PICKUP_PHYSICAL_MODELS: Record<
	PickupType,
	{ inductanceH: number; internalCapacitancePf: number; resonantQ: number; defaultGainDb: number; defaultImpedance: number }
> = {
	"single-coil": {
		inductanceH: 2.5,
		internalCapacitancePf: 110,
		resonantQ: 2.2,
		defaultGainDb: 0,
		defaultImpedance: 250000,
	},
	humbucker: {
		inductanceH: 4.5,
		internalCapacitancePf: 130,
		resonantQ: 1.8,
		defaultGainDb: 3.5,
		defaultImpedance: 500000,
	},
	active: {
		inductanceH: 0,
		internalCapacitancePf: 0,
		resonantQ: 0.7,
		defaultGainDb: 0,
		defaultImpedance: 1000000,
	},
	piezo: {
		inductanceH: 0,
		internalCapacitancePf: 500,
		resonantQ: 1.2,
		defaultGainDb: -2.0,
		defaultImpedance: 10000000,
	},
	custom: {
		inductanceH: 3.0,
		internalCapacitancePf: 120,
		resonantQ: 1.5,
		defaultGainDb: 0,
		defaultImpedance: 500000,
	},
};

export class InputProfileNode implements ChainNode {
	readonly id = "input-profile";
	readonly name = "Guitar Input Profile";
	readonly kind = "input-profile";
	bypassed = false;
	mix = 1.0;

	private config: InputProfileConfig;
	private sampleRate = 48000;
	private linearGain = 1.0;

	// Biquad filter state for pickup resonance
	private b0 = 1;
	private b1 = 0;
	private b2 = 0;
	private a1 = 0;
	private a2 = 0;
	private x1 = 0;
	private x2 = 0;
	private y1 = 0;
	private y2 = 0;

	constructor(config?: Partial<InputProfileConfig>) {
		const type: PickupType = config?.pickupType ?? "single-coil";
		const defaults = PICKUP_PHYSICAL_MODELS[type];

		const guitarCable = config?.guitarCableLengthMeters ?? 3.0;
		const patchCable = config?.patchCableLengthMeters ?? 0.15;
		const ampCable = config?.ampCableLengthMeters ?? 3.0;
		const cableCap = config?.cableCapacitancePfPerM ?? 100;

		const resonantFreqHz =
			config?.resonantFreqHz ??
			this.calculateResonantFreqHzFor(type, guitarCable, cableCap);

		this.config = {
			pickupType: type,
			impedanceOhms: config?.impedanceOhms ?? defaults.defaultImpedance,
			inputGainDb: config?.inputGainDb ?? defaults.defaultGainDb,
			guitarCableLengthMeters: guitarCable,
			patchCableLengthMeters: patchCable,
			ampCableLengthMeters: ampCable,
			cableCapacitancePfPerM: cableCap,
			resonantFreqHz,
			resonantQ: config?.resonantQ ?? defaults.resonantQ,
		};

		this.updateGain();
		this.updateFilter();
	}

	getConfig(): InputProfileConfig {
		return { ...this.config };
	}

	setPickupType(type: PickupType): void {
		this.config.pickupType = type;
		const defaults = PICKUP_PHYSICAL_MODELS[type];
		this.config.resonantQ = defaults.resonantQ;
		this.config.impedanceOhms = defaults.defaultImpedance;
		this.config.resonantFreqHz = this.calculateResonantFreqHz();
		this.updateGain();
		this.updateFilter();
	}

	setGuitarCableLength(meters: number): void {
		this.config.guitarCableLengthMeters = Math.max(0, meters);
		this.config.resonantFreqHz = this.calculateResonantFreqHz();
		this.updateFilter();
	}

	setPatchCableLength(meters: number): void {
		this.config.patchCableLengthMeters = Math.max(0, meters);
	}

	setAmpCableLength(meters: number): void {
		this.config.ampCableLengthMeters = Math.max(0, meters);
	}

	setCableCapacitancePfPerM(pfPerM: number): void {
		this.config.cableCapacitancePfPerM = Math.max(20, Math.min(300, pfPerM));
		this.config.resonantFreqHz = this.calculateResonantFreqHz();
		this.updateFilter();
	}

	private calculateResonantFreqHz(): number {
		return this.calculateResonantFreqHzFor(
			this.config.pickupType,
			this.config.guitarCableLengthMeters ?? 3.0,
			this.config.cableCapacitancePfPerM ?? 100,
		);
	}

	private calculateResonantFreqHzFor(
		pickupType: PickupType,
		guitarCableMeters: number,
		pfPerM: number,
	): number {
		if (pickupType === "active") return 12000;
		if (pickupType === "piezo") return 6500;

		const model = PICKUP_PHYSICAL_MODELS[pickupType];
		const totalCapPf = model.internalCapacitancePf + guitarCableMeters * pfPerM;
		const totalCapF = totalCapPf * 1e-12;
		const L = model.inductanceH;

		if (L <= 0 || totalCapF <= 0) return 3500;
		const f0 = 1 / (2 * Math.PI * Math.sqrt(L * totalCapF));
		return Math.round(f0);
	}

	setImpedance(ohms: number): void {
		this.config.impedanceOhms = Math.max(10000, Math.min(10000000, ohms));
		this.updateFilter();
	}

	setInputGainDb(db: number): void {
		this.config.inputGainDb = Math.max(-24, Math.min(24, db));
		this.updateGain();
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.updateFilter();
		this.reset();
	}

	reset(): void {
		this.x1 = 0;
		this.x2 = 0;
		this.y1 = 0;
		this.y2 = 0;
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "inputGainDb":
				return this.config.inputGainDb;
			case "impedanceOhms":
				return this.config.impedanceOhms;
			case "guitarCableLengthMeters":
				return this.config.guitarCableLengthMeters;
			case "patchCableLengthMeters":
				return this.config.patchCableLengthMeters;
			case "ampCableLengthMeters":
				return this.config.ampCableLengthMeters;
			case "cableCapacitancePfPerM":
				return this.config.cableCapacitancePfPerM;
			case "resonantFreqHz":
				return this.config.resonantFreqHz;
			case "resonantQ":
				return this.config.resonantQ;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "inputGainDb":
				this.setInputGainDb(value);
				break;
			case "impedanceOhms":
				this.setImpedance(value);
				break;
			case "guitarCableLengthMeters":
				this.setGuitarCableLength(value);
				break;
			case "patchCableLengthMeters":
				this.setPatchCableLength(value);
				break;
			case "ampCableLengthMeters":
				this.setAmpCableLength(value);
				break;
			case "cableCapacitancePfPerM":
				this.setCableCapacitancePfPerM(value);
				break;
			case "resonantFreqHz":
				this.config.resonantFreqHz = value;
				this.updateFilter();
				break;
			case "resonantQ":
				this.config.resonantQ = value;
				this.updateFilter();
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			inputGainDb: this.config.inputGainDb,
			impedanceOhms: this.config.impedanceOhms,
			guitarCableLengthMeters: this.config.guitarCableLengthMeters ?? 3.0,
			patchCableLengthMeters: this.config.patchCableLengthMeters ?? 0.15,
			ampCableLengthMeters: this.config.ampCableLengthMeters ?? 3.0,
			cableCapacitancePfPerM: this.config.cableCapacitancePfPerM ?? 100,
			resonantFreqHz: this.config.resonantFreqHz ?? 3000,
			resonantQ: this.config.resonantQ ?? 1.5,
		};
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const output = new Float64Array(length);

		if (this.bypassed) {
			for (let i = 0; i < length; i++) {
				output[i] = input[i] ?? 0;
			}
			return output;
		}

		for (let i = 0; i < length; i++) {
			const x = (input[i] ?? 0) * this.linearGain;
			// 2nd-order Direct Form II Transposed / Direct Form I biquad
			const y =
				this.b0 * x +
				this.b1 * this.x1 +
				this.b2 * this.x2 -
				this.a1 * this.y1 -
				this.a2 * this.y2;

			this.x2 = this.x1;
			this.x1 = x;
			this.y2 = this.y1;
			this.y1 = y;

			output[i] = y;
		}

		return output;
	}

	private updateGain(): void {
		this.linearGain = Math.pow(10, this.config.inputGainDb / 20);
	}

	private updateFilter(): void {
		if (this.config.pickupType === "active") {
			// Transparent buffer
			this.b0 = 1;
			this.b1 = 0;
			this.b2 = 0;
			this.a1 = 0;
			this.a2 = 0;
			return;
		}

		const f0 = Math.min(this.config.resonantFreqHz ?? 3000, this.sampleRate * 0.45);
		// Pot impedance damping modifier
		const damping = Math.min(1.0, this.config.impedanceOhms / 500000);
		const q = Math.max(0.5, (this.config.resonantQ ?? 1.5) * (0.5 + 0.5 * damping));

		const w0 = (2 * Math.PI * f0) / this.sampleRate;
		const alpha = Math.sin(w0) / (2 * q);
		const cosw0 = Math.cos(w0);

		// Low-pass with resonant peak
		const b0 = (1 - cosw0) / 2;
		const b1 = 1 - cosw0;
		const b2 = (1 - cosw0) / 2;
		const a0 = 1 + alpha;
		const a1 = -2 * cosw0;
		const a2 = 1 - alpha;

		this.b0 = b0 / a0;
		this.b1 = b1 / a0;
		this.b2 = b2 / a0;
		this.a1 = a1 / a0;
		this.a2 = a2 / a0;
	}
}
