import {
	CabinetIrNode,
	InputProfileNode,
	NamNode,
	type PickupType,
	SignalChain,
} from "@vessel-dsp/chain";

export type AudioSourceType = "sample" | "mic" | "synth";

export interface AudioEngineOptions {
	sampleRate?: number;
	initialSource?: AudioSourceType;
	sampleUrl?: string;
}

export interface MeterData {
	rmsDb: number;
	peakDb: number;
	clipping: boolean;
	frequencyData: Uint8Array;
}

export class AudioEngine {
	readonly chain: SignalChain;

	private audioCtx: AudioContext | null = null;
	private sourceNode: AudioNode | null = null;
	private processorNode: ScriptProcessorNode | null = null;
	private analyserNode: AnalyserNode | null = null;
	private micStream: MediaStream | null = null;
	private sampleBuffer: AudioBuffer | null = null;
	private isPlaying = false;
	private currentSourceType: AudioSourceType = "sample";
	private samplePlaybackOffset = 0;
	private sampleStartTime = 0;

	// Metering buffers
	private freqArray: Uint8Array = new Uint8Array(128);
	private timeArray: Float32Array = new Float32Array(512);

	constructor(options?: AudioEngineOptions) {
		this.chain = new SignalChain({ sampleRate: options?.sampleRate ?? 48000 });
		if (options?.initialSource) {
			this.currentSourceType = options.initialSource;
		}
	}

	get source(): AudioSourceType {
		return this.currentSourceType;
	}

	get playing(): boolean {
		return this.isPlaying;
	}

	async initAudioContext(): Promise<AudioContext> {
		if (!this.audioCtx) {
			const AudioContextClass =
				typeof window !== "undefined"
					? window.AudioContext ||
					  (window as unknown as { webkitAudioContext: typeof AudioContext })
							.webkitAudioContext
					: undefined;
			if (!AudioContextClass) {
				throw new Error("AudioContext is not supported in this environment");
			}
			this.audioCtx = new AudioContextClass();
		}

		if (this.audioCtx.state === "suspended") {
			await this.audioCtx.resume();
		}

		this.chain.prepare(this.audioCtx.sampleRate);
		this.setupGraph();
		return this.audioCtx;
	}

	private setupGraph(): void {
		if (!this.audioCtx) return;

		// Create AnalyserNode for spectrum visualization and metering
		this.analyserNode = this.audioCtx.createAnalyser();
		this.analyserNode.fftSize = 256;
		this.analyserNode.smoothingTimeConstant = 0.8;
		this.freqArray = new Uint8Array(this.analyserNode.frequencyBinCount);
		this.timeArray = new Float32Array(this.analyserNode.fftSize);

		// ScriptProcessor bridge running SignalChain
		const bufferSize = 512;
		this.processorNode = this.audioCtx.createScriptProcessor(
			bufferSize,
			1,
			1,
		);

		this.processorNode.onaudioprocess = (e) => {
			const input = e.inputBuffer.getChannelData(0);
			const output = e.outputBuffer.getChannelData(0);

			if (!this.isPlaying && this.currentSourceType === "sample") {
				output.fill(0);
				return;
			}

			const processed = this.chain.process(input);
			for (let i = 0; i < bufferSize; i++) {
				output[i] = processed[i] ?? 0;
			}
		};

		this.processorNode.connect(this.analyserNode);
		this.analyserNode.connect(this.audioCtx.destination);
	}

	async loadSample(url: string): Promise<void> {
		const ctx = await this.initAudioContext();
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();
		this.sampleBuffer = await ctx.decodeAudioData(arrayBuffer);
	}

	setSampleBuffer(buffer: AudioBuffer): void {
		this.sampleBuffer = buffer;
	}

	async setSource(type: AudioSourceType): Promise<void> {
		this.currentSourceType = type;
		if (this.isPlaying) {
			await this.stop();
			await this.play();
		}
	}

	async play(): Promise<void> {
		const ctx = await this.initAudioContext();

		if (this.currentSourceType === "sample") {
			if (!this.sampleBuffer) {
				// Generate synthetic guitar chord sample if no buffer is loaded
				this.sampleBuffer = this.createSyntheticGuitarSample(ctx);
			}

			const bufferSource = ctx.createBufferSource();
			bufferSource.buffer = this.sampleBuffer;
			bufferSource.loop = true;

			bufferSource.connect(this.processorNode!);
			bufferSource.start(0, this.samplePlaybackOffset);

			this.sourceNode = bufferSource;
			this.sampleStartTime = ctx.currentTime - this.samplePlaybackOffset;
			this.isPlaying = true;
		} else if (this.currentSourceType === "mic") {
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error("Microphone input not supported in this browser");
			}

			this.micStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
				},
			});

			const micSource = ctx.createMediaStreamSource(this.micStream);
			micSource.connect(this.processorNode!);
			this.sourceNode = micSource;
			this.isPlaying = true;
		}
	}

	async stop(): Promise<void> {
		if (this.sourceNode) {
			if ("stop" in this.sourceNode && typeof (this.sourceNode as AudioBufferSourceNode).stop === "function") {
				try {
					(this.sourceNode as AudioBufferSourceNode).stop();
				} catch {}
			}
			this.sourceNode.disconnect();
			this.sourceNode = null;
		}

		if (this.micStream) {
			for (const track of this.micStream.getTracks()) {
				track.stop();
			}
			this.micStream = null;
		}

		this.isPlaying = false;
	}

	getMeterData(): MeterData {
		if (!this.analyserNode) {
			return { rmsDb: -100, peakDb: -100, clipping: false, frequencyData: new Uint8Array(0) };
		}

		(this.analyserNode.getByteFrequencyData as unknown as (arr: Uint8Array) => void)(this.freqArray);
		(this.analyserNode.getFloatTimeDomainData as unknown as (arr: Float32Array) => void)(this.timeArray);

		let sumSquares = 0;
		let peak = 0;

		for (let i = 0; i < this.timeArray.length; i++) {
			const abs = Math.abs(this.timeArray[i] ?? 0);
			sumSquares += abs * abs;
			if (abs > peak) peak = abs;
		}

		const rms = Math.sqrt(sumSquares / this.timeArray.length);
		const rmsDb = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
		const peakDb = peak > 0.00001 ? 20 * Math.log10(peak) : -100;

		return {
			rmsDb: Math.max(-100, rmsDb),
			peakDb: Math.max(-100, peakDb),
			clipping: peak >= 0.99,
			frequencyData: this.freqArray,
		};
	}

	private createSyntheticGuitarSample(ctx: AudioContext): AudioBuffer {
		// Create a 2-second synthesized clean guitar chord loop (E minor 9)
		const duration = 2.0;
		const sampleRate = ctx.sampleRate;
		const length = Math.floor(sampleRate * duration);
		const buffer = ctx.createBuffer(1, length, sampleRate);
		const data = buffer.getChannelData(0);

		const freqs = [82.4, 164.8, 196.0, 246.9, 329.6, 493.8]; // E2, E3, G3, B3, E4, B4

		for (let i = 0; i < length; i++) {
			const t = i / sampleRate;
			let sample = 0;

			for (let f = 0; f < freqs.length; f++) {
				const freq = freqs[f]!;
				const pluckDecay = Math.exp(-t * (1.5 + f * 0.4));
				// Fundamental + harmonics with karplus-strong style decay
				sample +=
					pluckDecay *
					(0.6 * Math.sin(2 * Math.PI * freq * t) +
						0.3 * Math.sin(2 * Math.PI * freq * 2 * t) +
						0.15 * Math.sin(2 * Math.PI * freq * 3 * t));
			}

			data[i] = sample * 0.15;
		}

		return buffer;
	}
}
