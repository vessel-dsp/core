import {
	type ChainNode,
	DEFAULT_POWER_SUPPLY_PROFILES,
	type PowerSupplyConfig,
	type PowerSupplyType,
} from "../types.js";

export class PowerSupplyNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "power-supply";
	bypassed = false;
	mix = 1.0;

	private config: PowerSupplyConfig;
	private sampleRate = 48000;

	// Dynamic envelope follower state for current draw tracking
	private envelope = 0.0;
	private attackCoeff = 0.0;
	private releaseCoeff = 0.0;

	// AC mains ripple phase accumulator
	private ripplePhase = 0.0;
	private currentRailVoltage = 9.0;

	constructor(
		id = "power-supply",
		name = "Power Supply & Rail Sag",
		config?: Partial<PowerSupplyConfig>,
	) {
		this.id = id;
		this.name = name;

		const type: PowerSupplyType = config?.type ?? "alkaline-9v";
		const defaults = DEFAULT_POWER_SUPPLY_PROFILES[type];

		this.config = {
			type,
			nominalVoltageV: config?.nominalVoltageV ?? defaults.nominalVoltageV,
			internalResistanceOhms:
				config?.internalResistanceOhms ?? defaults.internalResistanceOhms,
			sagFactor: config?.sagFactor ?? defaults.sagFactor,
			rippleVoltageV: config?.rippleVoltageV ?? defaults.rippleVoltageV ?? 0.0,
			rippleFrequencyHz:
				config?.rippleFrequencyHz ?? defaults.rippleFrequencyHz ?? 120,
		};

		this.updateTimeConstants();
	}

	getConfig(): PowerSupplyConfig {
		return { ...this.config };
	}

	setType(type: PowerSupplyType): void {
		const defaults = DEFAULT_POWER_SUPPLY_PROFILES[type];
		this.config.type = type;
		this.config.nominalVoltageV = defaults.nominalVoltageV;
		this.config.internalResistanceOhms = defaults.internalResistanceOhms;
		this.config.sagFactor = defaults.sagFactor;
		this.config.rippleVoltageV = defaults.rippleVoltageV ?? 0.0;
		this.config.rippleFrequencyHz = defaults.rippleFrequencyHz ?? 120;
	}

	setNominalVoltageV(volts: number): void {
		this.config.nominalVoltageV = Math.max(3.0, Math.min(30.0, volts));
	}

	setInternalResistanceOhms(ohms: number): void {
		this.config.internalResistanceOhms = Math.max(0.01, Math.min(500.0, ohms));
	}

	setSagFactor(factor: number): void {
		this.config.sagFactor = Math.max(0.0, Math.min(1.0, factor));
	}

	setRippleVoltageV(volts: number): void {
		this.config.rippleVoltageV = Math.max(0.0, Math.min(1.0, volts));
	}

	getInstantaneousRailVoltage(): number {
		return this.currentRailVoltage;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.updateTimeConstants();
		this.reset();
	}

	reset(): void {
		this.envelope = 0.0;
		this.ripplePhase = 0.0;
		this.currentRailVoltage = this.config.nominalVoltageV;
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "nominalVoltageV":
				return this.config.nominalVoltageV;
			case "internalResistanceOhms":
				return this.config.internalResistanceOhms;
			case "sagFactor":
				return this.config.sagFactor;
			case "rippleVoltageV":
				return this.config.rippleVoltageV ?? 0.0;
			case "rippleFrequencyHz":
				return this.config.rippleFrequencyHz ?? 120;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "nominalVoltageV":
				this.setNominalVoltageV(value);
				break;
			case "internalResistanceOhms":
				this.setInternalResistanceOhms(value);
				break;
			case "sagFactor":
				this.setSagFactor(value);
				break;
			case "rippleVoltageV":
				this.setRippleVoltageV(value);
				break;
			case "rippleFrequencyHz":
				this.config.rippleFrequencyHz = value;
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			nominalVoltageV: this.config.nominalVoltageV,
			internalResistanceOhms: this.config.internalResistanceOhms,
			sagFactor: this.config.sagFactor,
			rippleVoltageV: this.config.rippleVoltageV ?? 0.0,
			rippleFrequencyHz: this.config.rippleFrequencyHz ?? 120,
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

		const nominalV = this.config.nominalVoltageV;
		const rInt = this.config.internalResistanceOhms;
		const sagFactor = this.config.sagFactor;
		const rippleAmp = this.config.rippleVoltageV ?? 0.0;
		const rippleFreq = this.config.rippleFrequencyHz ?? 120;
		const phaseIncrement = (2 * Math.PI * rippleFreq) / this.sampleRate;

		for (let i = 0; i < length; i++) {
			const x = input[i] ?? 0;
			const absX = Math.abs(x);

			// Ballistics envelope follower tracking current draw
			if (absX > this.envelope) {
				this.envelope += this.attackCoeff * (absX - this.envelope);
			} else {
				this.envelope += this.releaseCoeff * (absX - this.envelope);
			}

			// Calculate dynamic sag delta V: deltaV = envelope * sagFactor * (rInt / 100) * nominalV * 0.4
			const sagDeltaV =
				this.envelope * sagFactor * (rInt / 100) * (nominalV * 0.45);
			let dynamicV = Math.max(2.5, nominalV - sagDeltaV);

			// Add AC mains ripple if configured
			if (rippleAmp > 0) {
				const ripple = rippleAmp * Math.sin(this.ripplePhase);
				dynamicV += ripple;
				this.ripplePhase += phaseIncrement;
				if (this.ripplePhase > 2 * Math.PI) {
					this.ripplePhase -= 2 * Math.PI;
				}
			}

			this.currentRailVoltage = dynamicV;

			// Headroom scale relative to standard 9V baseline
			const headroom = dynamicV / 9.0;
			const scaledX = x / Math.max(0.1, headroom);

			// Soft asymmetrical saturation when voltage is starved
			let y = scaledX;
			if (headroom < 0.98) {
				// Voltage starvation: cubic soft-knee saturation with bias asymmetry
				const biasOffset = (1.0 - headroom) * 0.08;
				const biased = scaledX + biasOffset;
				if (biased > 1.0) {
					y = 1.0 - 1.0 / (3.0 * biased * biased);
				} else if (biased < -1.0) {
					y = -1.0 + 1.0 / (3.0 * biased * biased);
				} else {
					y = biased - (biased * biased * biased) / 3.0;
				}
				y = (y - biasOffset) * headroom;
			} else {
				// Linear / high headroom with gentle soft-knee limit at rails
				if (scaledX > 1.2) {
					y = 1.2 * headroom;
				} else if (scaledX < -1.2) {
					y = -1.2 * headroom;
				} else {
					y = x;
				}
			}

			output[i] = y;
		}

		return output;
	}

	private updateTimeConstants(): void {
		// Attack ~8 ms, Release ~75 ms (emulates power supply bulk capacitor discharge/recharge)
		const attackTimeSec = 0.008;
		const releaseTimeSec = 0.075;
		this.attackCoeff = 1.0 - Math.exp(-1.0 / (attackTimeSec * this.sampleRate));
		this.releaseCoeff =
			1.0 - Math.exp(-1.0 / (releaseTimeSec * this.sampleRate));
	}
}
