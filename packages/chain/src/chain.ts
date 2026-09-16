import { CabinetIrNode } from "./nodes/ir-node.js";
import { GainNode } from "./nodes/gain-node.js";
import { InputProfileNode } from "./nodes/input-profile-node.js";
import { MasterNode } from "./nodes/master-node.js";
import { NamNode } from "./nodes/nam-node.js";
import { PowerSupplyNode } from "./nodes/power-supply-node.js";
import type {
	ChainNode,
	ChainPreset,
	NodeSnapshot,
	SignalChainOptions,
} from "./types.js";

export class SignalChain {
	readonly inputProfile: InputProfileNode;
	readonly master: MasterNode;

	private nodes: ChainNode[] = [];
	private sampleRate = 48000;

	constructor(options?: SignalChainOptions) {
		this.inputProfile = new InputProfileNode(options?.inputProfile);
		this.master = new MasterNode(options?.master);
		if (options?.sampleRate) {
			this.sampleRate = options.sampleRate;
			this.prepare(options.sampleRate);
		}
	}

	addNode(node: ChainNode): this {
		const existingIndex = this.nodes.findIndex((n) => n.id === node.id);
		if (existingIndex >= 0) {
			this.nodes[existingIndex] = node;
		} else {
			this.nodes.push(node);
		}
		node.prepare(this.sampleRate);
		return this;
	}

	insertNode(node: ChainNode, index: number): this {
		this.removeNode(node.id);
		const targetIndex = Math.max(0, Math.min(this.nodes.length, index));
		this.nodes.splice(targetIndex, 0, node);
		node.prepare(this.sampleRate);
		return this;
	}

	moveNode(id: string, targetIndex: number): boolean {
		const currentIndex = this.nodes.findIndex((n) => n.id === id);
		if (currentIndex < 0) return false;

		const [node] = this.nodes.splice(currentIndex, 1);
		if (!node) return false;

		const clampedIndex = Math.max(0, Math.min(this.nodes.length, targetIndex));
		this.nodes.splice(clampedIndex, 0, node);
		return true;
	}

	reorderNodes(orderedIds: readonly string[]): boolean {
		const newNodes: ChainNode[] = [];
		const remaining = new Map(this.nodes.map((n) => [n.id, n]));

		for (const id of orderedIds) {
			const node = remaining.get(id);
			if (node) {
				newNodes.push(node);
				remaining.delete(id);
			}
		}

		// Append any nodes that were not explicitly listed
		for (const node of remaining.values()) {
			newNodes.push(node);
		}

		this.nodes = newNodes;
		return true;
	}

	removeNode(id: string): boolean {
		const index = this.nodes.findIndex((n) => n.id === id);
		if (index >= 0) {
			this.nodes.splice(index, 1);
			return true;
		}
		return false;
	}

	clearNodes(): this {
		this.nodes = [];
		return this;
	}

	getNode(id: string): ChainNode | undefined {
		if (id === this.inputProfile.id) return this.inputProfile;
		if (id === this.master.id) return this.master;
		return this.nodes.find((n) => n.id === id);
	}

	getNodes(): readonly ChainNode[] {
		return [this.inputProfile, ...this.nodes, this.master];
	}

	getEffectNodes(): readonly ChainNode[] {
		return [...this.nodes];
	}

	get length(): number {
		return this.nodes.length;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.inputProfile.prepare(sampleRate);
		for (const node of this.nodes) {
			node.prepare(sampleRate);
		}
		this.master.prepare(sampleRate);
	}

	reset(): void {
		this.inputProfile.reset();
		for (const node of this.nodes) {
			node.reset();
		}
		this.master.reset();
	}

	process(input: Float64Array | Float32Array): Float64Array {
		let current = this.inputProfile.process(input);

		for (const node of this.nodes) {
			current = node.process(current);
		}

		return this.master.process(current);
	}

	getPreset(name = "Default Preset"): ChainPreset {
		const snapshots: NodeSnapshot[] = this.nodes.map((n) => ({
			id: n.id,
			name: n.name,
			kind: n.kind,
			bypassed: n.bypassed,
			mix: n.mix,
			params: n.getParams(),
		}));

		return {
			name,
			version: "1.0",
			inputProfile: this.inputProfile.getConfig(),
			nodes: snapshots,
			master: this.master.getConfig(),
		};
	}

	loadPreset(
		preset: ChainPreset,
		nodeFactory?: (snap: NodeSnapshot) => ChainNode | undefined,
	): void {
		if (preset.inputProfile) {
			this.inputProfile.setPickupType(preset.inputProfile.pickupType);
			this.inputProfile.setImpedance(preset.inputProfile.impedanceOhms);
			this.inputProfile.setInputGainDb(preset.inputProfile.inputGainDb);
			if (preset.inputProfile.resonantFreqHz !== undefined) {
				this.inputProfile.setParam("resonantFreqHz", preset.inputProfile.resonantFreqHz);
			}
			if (preset.inputProfile.resonantQ !== undefined) {
				this.inputProfile.setParam("resonantQ", preset.inputProfile.resonantQ);
			}
		}

		if (preset.master) {
			this.master.setVolumeDb(preset.master.volumeDb);
			this.master.setMuted(preset.master.muted);
			this.master.setLimiter(preset.master.limiter);
		}

		if (preset.nodes) {
			for (const snap of preset.nodes) {
				let node = this.getNode(snap.id);
				if (!node && nodeFactory) {
					node = nodeFactory(snap);
					if (node) {
						this.addNode(node);
					}
				}

				if (node) {
					node.bypassed = snap.bypassed;
					node.mix = snap.mix;
					for (const [key, val] of Object.entries(snap.params)) {
						node.setParam(key, val);
					}
				}
			}
		}
	}

	toJson(name = "Signal Chain"): string {
		return JSON.stringify(this.getPreset(name), null, 2);
	}

	static fromJson(
		jsonStr: string,
		options?: {
			sampleRate?: number;
			nodeFactory?: (snap: NodeSnapshot) => ChainNode | undefined;
		},
	): SignalChain {
		const preset = JSON.parse(jsonStr) as ChainPreset;
		const chain = new SignalChain({ sampleRate: options?.sampleRate ?? 48000 });

		const defaultFactory = (snap: NodeSnapshot): ChainNode | undefined => {
			if (snap.kind === "nam") {
				return new NamNode(snap.id, snap.name);
			}
			if (snap.kind === "cabinet-ir") {
				return new CabinetIrNode(snap.id, snap.name);
			}
			if (snap.kind === "gain") {
				return new GainNode(snap.id, snap.name);
			}
			if (snap.kind === "power-supply") {
				return new PowerSupplyNode(snap.id, snap.name);
			}
			return undefined;
		};

		chain.loadPreset(preset, options?.nodeFactory ?? defaultFactory);
		return chain;
	}
}
