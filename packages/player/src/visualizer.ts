import type { MeterData } from "./audio-engine.js";

export interface VisualizerOptions {
	primaryColor?: string;
	accentColor?: string;
	gridColor?: string;
	backgroundColor?: string;
	textColor?: string;
}

export class SpectrumVisualizer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;
	private primaryColor = "#FF513A"; // Brand primary orange
	private accentColor = "#FF513A"; // Clip / peak
	private gridColor = "rgba(185, 185, 185, 0.2)"; // Light gray lines
	private backgroundColor = "#1d1d1d"; // VesselDSP black
	private textColor = "#b9b9b9";

	constructor(canvas: HTMLCanvasElement, options?: VisualizerOptions) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		if (options?.primaryColor) this.primaryColor = options.primaryColor;
		if (options?.accentColor) this.accentColor = options.accentColor;
		if (options?.gridColor) this.gridColor = options.gridColor;
		if (options?.backgroundColor) this.backgroundColor = options.backgroundColor;
		if (options?.textColor) this.textColor = options.textColor;
	}

	setColors(options: VisualizerOptions): void {
		if (options.primaryColor) this.primaryColor = options.primaryColor;
		if (options.accentColor) this.accentColor = options.accentColor;
		if (options.gridColor) this.gridColor = options.gridColor;
		if (options.backgroundColor) this.backgroundColor = options.backgroundColor;
		if (options.textColor) this.textColor = options.textColor;
	}

	render(meter: MeterData): void {
		const ctx = this.ctx;
		if (!ctx) return;

		const width = this.canvas.width;
		const height = this.canvas.height;

		// Clear background
		ctx.fillStyle = this.backgroundColor;
		ctx.fillRect(0, 0, width, height);

		// Draw grid lines (dB horizontal lines)
		ctx.strokeStyle = this.gridColor;
		ctx.lineWidth = 1;

		for (const db of [-12, -24, -48]) {
			const y = height * (1 - (db + 60) / 60);
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();

			ctx.fillStyle = this.textColor;
			ctx.font = '9px "Space Mono", monospace';
			ctx.fillText(`${db}DB`, 4, y - 2);
		}

		// Draw FFT Frequency Spectrum Bars / Fill
		const bins = meter.frequencyData;
		const binCount = bins.length;

		if (binCount > 0) {
			const gradient = ctx.createLinearGradient(0, height, 0, 0);
			gradient.addColorStop(0, "rgba(255, 81, 58, 0.1)");
			gradient.addColorStop(0.7, "rgba(255, 81, 58, 0.7)");
			gradient.addColorStop(1, "rgba(255, 81, 58, 1.0)");

			ctx.beginPath();
			ctx.moveTo(0, height);

			const sliceWidth = width / binCount;
			for (let i = 0; i < binCount; i++) {
				const v = (bins[i] ?? 0) / 255.0;
				const y = height * (1.0 - v);
				const x = i * sliceWidth;

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			ctx.lineTo(width, height);
			ctx.closePath();
			ctx.fillStyle = gradient;
			ctx.fill();

			// Spectrum outline curve
			ctx.strokeStyle = this.primaryColor;
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Draw dB RMS & Peak Meter Bar on right side
		const meterWidth = 12;
		const meterX = width - meterWidth - 4;
		const meterHeight = height - 8;
		const meterY = 4;

		// Meter background
		ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
		ctx.fillRect(meterX, meterY, meterWidth, meterHeight);

		// Meter border
		ctx.strokeStyle = this.gridColor;
		ctx.lineWidth = 1;
		ctx.strokeRect(meterX, meterY, meterWidth, meterHeight);

		// Meter fill normalized (-60dB to 0dB)
		const normRms = Math.max(0, Math.min(1, (meter.rmsDb + 60) / 60));
		const barFillHeight = meterHeight * normRms;

		const meterGrad = ctx.createLinearGradient(0, meterY + meterHeight, 0, meterY);
		meterGrad.addColorStop(0, "#ffffff");
		meterGrad.addColorStop(0.7, "#b9b9b9");
		meterGrad.addColorStop(1, this.primaryColor);

		ctx.fillStyle = meterGrad;
		ctx.fillRect(meterX + 1, meterY + meterHeight - barFillHeight, meterWidth - 2, barFillHeight);

		// Clip indicator LED
		if (meter.clipping) {
			ctx.fillStyle = this.accentColor;
			ctx.fillRect(meterX + 1, meterY, meterWidth - 2, 4);
		}
	}
}
