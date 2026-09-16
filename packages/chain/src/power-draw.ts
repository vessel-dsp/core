import type { CircuitDocument, Component } from "@vessel-dsp/core";

export interface PowerDrawEstimate {
	/** Quiescent/idling current draw in milliamps (mA) */
	quiescentCurrentMa: number;
	/** Estimated peak dynamic current draw in milliamps (mA) under full signal load */
	peakCurrentMa: number;
	/** Estimated average power dissipation in milliwatts (mW) */
	powerDissipationMw: number;
	/** Primary supply voltage in Volts (e.g. 9.0V, 18.0V) */
	supplyVoltageV: number;
	/** Current draw breakdown by subsystem in mA */
	breakdown: {
		activeIcMa: number;
		discreteBjtMa: number;
		ledMa: number;
		passiveDividerMa: number;
	};
}

export function estimateCircuitPowerDraw(
	document: CircuitDocument,
	options?: { supplyVoltageV?: number },
): PowerDrawEstimate {
	const supplyV = options?.supplyVoltageV ?? 9.0;

	let activeIcMa = 0.0;
	let discreteBjtMa = 0.0;
	let ledMa = 0.0;
	let passiveDividerMa = 0.0;

	for (const comp of document.components) {
		switch (comp.kind) {
			case "opamp":
				activeIcMa += 2.5; // typical dual op-amp quiescent draw (RC4558, TL072, MC33178)
				break;
			case "ota":
				activeIcMa += 2.0; // CA3080 / LM13700 OTA draw
				break;
			case "bbd":
			case "delay-ic":
				activeIcMa += 18.0; // MN3007 / PT2399 delay processor
				break;
			case "power-amp":
				activeIcMa += 25.0; // LM386 or discrete power amplifier
				break;
			case "bjt":
				discreteBjtMa += 0.8; // 2N3904 / 2N5088 bias draw
				break;
			case "jfet":
			case "mosfet":
				discreteBjtMa += 0.5; // 2N5457 / BS170 bias draw
				break;
			case "led":
				ledMa += 2.0; // Standard bypass indicator LED
				break;
			case "resistor":
				// If a bias divider resistor is directly tied to rail with high conductance (< 50k)
				if (
					comp.name.toUpperCase().startsWith("R_BIAS") ||
					comp.name.toUpperCase().startsWith("RB")
				) {
					passiveDividerMa += 0.2;
				}
				break;
		}
	}

	// Always guarantee minimal base circuit quiescent baseline
	if (
		activeIcMa === 0 &&
		discreteBjtMa === 0 &&
		ledMa === 0 &&
		passiveDividerMa === 0
	) {
		passiveDividerMa = 0.5;
	}

	const quiescentCurrentMa = Math.round(
		(activeIcMa + discreteBjtMa + ledMa + passiveDividerMa) * 100,
	) / 100;
	const peakCurrentMa = Math.round(quiescentCurrentMa * 1.65 * 100) / 100;
	const powerDissipationMw = Math.round(quiescentCurrentMa * supplyV * 10) / 10;

	return {
		quiescentCurrentMa,
		peakCurrentMa,
		powerDissipationMw,
		supplyVoltageV: supplyV,
		breakdown: {
			activeIcMa: Math.round(activeIcMa * 100) / 100,
			discreteBjtMa: Math.round(discreteBjtMa * 100) / 100,
			ledMa: Math.round(ledMa * 100) / 100,
			passiveDividerMa: Math.round(passiveDividerMa * 100) / 100,
		},
	};
}
