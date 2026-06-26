import type { CircuitDocument, Point } from "./types";

export type NodeId = number;

export type PinRef = Readonly<{
	componentId: string;
	terminalName: string;
}>;

export type Connectivity = Readonly<{
	pinToNode: ReadonlyMap<string, NodeId>;
	nodeMembers: ReadonlyMap<NodeId, readonly PinRef[]>;
	groundNodeId: NodeId | null;
	nodeCount: number;
}>;

export function pinKey(pin: PinRef): string {
	return `${pin.componentId}:${pin.terminalName}`;
}

export function getPinNode(
	connectivity: Connectivity,
	pin: PinRef,
): NodeId | undefined {
	return connectivity.pinToNode.get(pinKey(pin));
}

class UnionFind {
	private readonly parent = new Map<string, string>();

	add(x: string): void {
		if (!this.parent.has(x)) {
			this.parent.set(x, x);
		}
	}

	find(x: string): string {
		this.add(x);
		let cur = x;
		while (true) {
			const par = this.parent.get(cur);
			if (par === undefined || par === cur) {
				return cur;
			}
			const grand = this.parent.get(par);
			if (grand === undefined || grand === par) {
				return par;
			}
			this.parent.set(cur, grand);
			cur = grand;
		}
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) {
			this.parent.set(rootA, rootB);
		}
	}
}

function pointKey(p: Point): string {
	return `${p.x},${p.y}`;
}

function unionTJunctions(uf: UnionFind, doc: CircuitDocument): void {
	const candidates: Point[] = [];
	for (const wire of doc.wires) {
		candidates.push(wire.endpoints[0], wire.endpoints[1]);
	}
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			candidates.push(terminal.position);
		}
	}

	for (const point of candidates) {
		for (const wire of doc.wires) {
			const a = wire.endpoints[0];
			const b = wire.endpoints[1];
			if (
				(point.x === a.x && point.y === a.y) ||
				(point.x === b.x && point.y === b.y)
			) {
				continue;
			}
			if (pointOnSegment(point, a, b)) {
				uf.union(pointKey(point), pointKey(a));
			}
		}
	}
}

type LeadAxis = Readonly<{
	x: number;
	y: number;
	orientation: "vertical" | "horizontal";
	reach: number;
}>;

function computeLeadAxis(terminal: Point, origin: Point): LeadAxis | null {
	const dx = terminal.x - origin.x;
	const dy = terminal.y - origin.y;
	if (dx === 0 && dy === 0) {
		return null;
	}
	if (Math.abs(dy) >= Math.abs(dx)) {
		return {
			x: terminal.x,
			y: terminal.y,
			orientation: "vertical",
			reach: origin.y,
		};
	}
	return {
		x: terminal.x,
		y: terminal.y,
		orientation: "horizontal",
		reach: origin.x,
	};
}

function pointOnLeadAxis(p: Point, lead: LeadAxis): boolean {
	if (lead.orientation === "vertical") {
		if (p.x !== lead.x) return false;
		const lo = Math.min(lead.y, lead.reach);
		const hi = Math.max(lead.y, lead.reach);
		return p.y > lo && p.y < hi;
	}
	if (p.y !== lead.y) return false;
	const lo = Math.min(lead.x, lead.reach);
	const hi = Math.max(lead.x, lead.reach);
	return p.x > lo && p.x < hi;
}

function unionLeadTaps(uf: UnionFind, doc: CircuitDocument): void {
	for (const component of doc.components) {
		for (const terminal of component.terminals) {
			const lead = computeLeadAxis(terminal.position, component.origin);
			if (lead === null) {
				continue;
			}
			const terminalKey = pointKey(terminal.position);
			for (const wire of doc.wires) {
				for (const endpoint of wire.endpoints) {
					if (
						endpoint.x === terminal.position.x &&
						endpoint.y === terminal.position.y
					) {
						continue;
					}
					if (pointOnLeadAxis(endpoint, lead)) {
						uf.union(pointKey(endpoint), terminalKey);
					}
				}
			}
		}
	}
}

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
	const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
	if (cross !== 0) {
		return false;
	}
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	if (minX === maxX && minY === maxY) {
		return false;
	}
	const inXRange = p.x > minX && p.x < maxX;
	const inYRange = p.y > minY && p.y < maxY;
	if (minX === maxX) {
		return inYRange;
	}
	if (minY === maxY) {
		return inXRange;
	}
	return inXRange && inYRange;
}

export function resolveConnectivity(doc: CircuitDocument): Connectivity {
	const uf = new UnionFind();
	const pinsByPoint = new Map<string, PinRef[]>();
	const groundPoints: string[] = [];

	for (const component of doc.components) {
		const isGround = component.kind === "ground";
		for (const terminal of component.terminals) {
			const pk = pointKey(terminal.position);
			uf.add(pk);
			const pin: PinRef = {
				componentId: component.id,
				terminalName: terminal.name,
			};
			const existing = pinsByPoint.get(pk);
			if (existing) {
				existing.push(pin);
			} else {
				pinsByPoint.set(pk, [pin]);
			}
			if (isGround) {
				groundPoints.push(pk);
			}
		}
	}

	for (const wire of doc.wires) {
		const a = pointKey(wire.endpoints[0]);
		const b = pointKey(wire.endpoints[1]);
		uf.union(a, b);
	}

	unionTJunctions(uf, doc);
	unionLeadTaps(uf, doc);

	const first = groundPoints[0];
	if (first !== undefined) {
		for (let i = 1; i < groundPoints.length; i += 1) {
			const next = groundPoints[i];
			if (next !== undefined) {
				uf.union(first, next);
			}
		}
	}
	const groundRoot = first !== undefined ? uf.find(first) : null;

	const rootToNodeId = new Map<string, NodeId>();
	const pinToNode = new Map<string, NodeId>();
	const nodeMembers = new Map<NodeId, PinRef[]>();
	let nextId: NodeId = groundRoot !== null ? 1 : 0;

	if (groundRoot !== null) {
		rootToNodeId.set(groundRoot, 0);
		nodeMembers.set(0, []);
	}

	for (const [pointKeyStr, pins] of pinsByPoint) {
		const root = uf.find(pointKeyStr);
		let nodeId = rootToNodeId.get(root);
		if (nodeId === undefined) {
			nodeId = nextId;
			nextId += 1;
			rootToNodeId.set(root, nodeId);
			nodeMembers.set(nodeId, []);
		}
		const members = nodeMembers.get(nodeId);
		if (members === undefined) {
			throw new Error(`unreachable: node ${nodeId} missing from nodeMembers`);
		}
		for (const pin of pins) {
			pinToNode.set(pinKey(pin), nodeId);
			members.push(pin);
		}
	}

	return {
		pinToNode,
		nodeMembers,
		groundNodeId: groundRoot !== null ? 0 : null,
		nodeCount: rootToNodeId.size,
	};
}
