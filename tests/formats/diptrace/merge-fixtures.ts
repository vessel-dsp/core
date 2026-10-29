import type {
	ConvertDipTraceResult,
} from "../../../packages/core/src/formats/diptrace/convert";
import type {
	DipTraceLibrarySection,
	DipTraceModel,
	DipTraceNet,
	DipTracePart,
} from "../../../packages/core/src/formats/diptrace/parser";
import { serializeInterchangeYaml } from "../../../packages/core/src/formats/interchange/serializer";

// --- Synthetic DipTrace models for the IC package-merge controls ---------------
//
// Hand-built layer-A models (plain typed literals, never parsed prose): a
// dual op-amp as two 4-pin sections of one package, a quad as four sections,
// plus the decline shapes. The layer-A parser is covered by the A1 parity
// harness; these models exercise only layer B (convertDipTrace).

export function syntheticSection(
	style: string,
	sectionId: string,
	name: string,
	pads: readonly string[],
): DipTraceLibrarySection {
	return {
		style,
		sectionId,
		name,
		partName: `Part ${Number(sectionId) + 1}`,
		value: "",
		categoryIndex: null,
		pins: pads.map((pad, index) => ({
			pinId: String(index),
			padNumber: pad,
			padId: "",
			name: pad,
			electricType: "Undefined",
			x: "",
			y: "",
		})),
		shapes: [],
	};
}

export function syntheticPart(
	library: readonly DipTraceLibrarySection[],
	id: string,
	style: string,
	sectionId: string,
	refDes: string,
	value: string,
	nets: ReadonlyArray<string | null>,
	name = "",
): DipTracePart {
	const section = library.find(
		(entry) => entry.style === style && entry.sectionId === sectionId,
	);
	return {
		id,
		style,
		section: sectionId,
		refDes,
		partRefDes: String(Number(sectionId) + 1),
		partName: section?.partName ?? "",
		value,
		name,
		baseName: "",
		manufacturer: "",
		datasheet: "",
		libPath: "",
		categoryIndex: null,
		sheet: "0",
		x: "0",
		y: "0",
		pins: nets.map((net, index) => {
			const libraryPin = section?.pins[index];
			return {
				pinId: String(index),
				netId: net,
				padNumber: libraryPin?.padNumber ?? String(index),
				padId: libraryPin?.padId ?? "",
				name: libraryPin?.name ?? "",
				electricType: libraryPin?.electricType ?? "",
				libraryPinMissing: libraryPin === undefined,
			};
		}),
	};
}

export function syntheticNet(
	id: string,
	members: ReadonlyArray<readonly [string, string]>,
): DipTraceNet {
	return {
		id,
		name: "",
		netClass: "",
		hiddenId: "",
		members: members.map(([partId, pinId]) => ({ partId, pinId })),
	};
}

export const SYN_RESISTOR_SECTION = syntheticSection("SYN-RES", "0", "RES", ["1", "2"]);
export const SYN_CONNECTOR_SECTION = syntheticSection("SYN-CNCT", "0", "CNCT", ["1"]);
export const SYN_GROUND_SECTION = syntheticSection("SYN-GND", "0", "GRND", ["1"]);

// A dual op-amp (gain-of-11 section A into follower section B) as two
// schematic parts of one package. Supplies ride dedicated single-member nets:
// the source states no negative rail, so the compiler's silent fallback
// applies to both the merged document and the canonical twin below.
export function dualOpampModel(options: {
	tag?: string;
	refDes?: string;
	values?: readonly [string, string];
	padsA?: readonly string[];
	padsB?: readonly string[];
	netA3?: string;
	netB3?: string;
	librarySectionB?: boolean;
	sparePads?: readonly string[];
	/** Omit the IN/OUT connectors and ground (for multi-group models sharing one audio pair). */
	audio?: boolean;
} = {}): DipTraceModel {
	const tag = options.tag ?? "";
	const refDes = options.refDes ?? "IC1";
	const values = options.values ?? (["TL072", "TL072"] as const);
	const padsA = options.padsA ?? ["1", "2", "3", "4"];
	const padsB = options.padsB ?? ["5", "6", "7", "8"];
	const n = (id: string): string => `${tag}${id}`;
	const netA3 = options.netA3 ?? n("nP4");
	const netB3 = options.netB3 ?? n("nP8");
	const library: DipTraceLibrarySection[] = [
		syntheticSection("SYN-DUAL", "0", "", padsA),
		SYN_GROUND_SECTION,
		SYN_CONNECTOR_SECTION,
		SYN_RESISTOR_SECTION,
	];
	if (options.librarySectionB !== false) {
		library.unshift(syntheticSection("SYN-DUAL", "1", "", padsB));
	}
	if (options.sparePads !== undefined) {
		library.push(syntheticSection("SYN-DUAL", "2", "", options.sparePads));
	}
	const parts: DipTracePart[] = [
		syntheticPart(library, `${tag}0`, "SYN-DUAL", "0", refDes, values[0]!, [
			n("nAOUT"),
			n("nAFB"),
			n("nIN"),
			netA3,
		]),
		syntheticPart(library, `${tag}1`, "SYN-DUAL", "1", refDes, values[1]!, [
			n("nAOUT"),
			n("nBOUT"),
			n("nBOUT"),
			netB3,
		]),
		syntheticPart(library, `${tag}5`, "SYN-RES", "0", `${tag}Rg`, "10k", [n("nAFB"), n("n0")]),
		syntheticPart(library, `${tag}6`, "SYN-RES", "0", `${tag}Rf`, "100k", [n("nAOUT"), n("nAFB")]),
		syntheticPart(library, `${tag}7`, "SYN-RES", "0", `${tag}Rload`, "100k", [n("nBOUT"), n("n0")]),
	];
	if (options.audio !== false) {
		parts.push(
			syntheticPart(library, `${tag}2`, "SYN-CNCT", "0", "Connector1", "IN", [n("nIN")]),
			syntheticPart(library, `${tag}3`, "SYN-CNCT", "0", "Connector2", "OUT", [n("nBOUT")]),
			syntheticPart(library, `${tag}4`, "SYN-GND", "0", "NetPort1", "", [n("n0")]),
		);
	}
	const membersByNet = new Map<string, Array<readonly [string, string]>>();
	for (const part of parts) {
		for (const pin of part.pins) {
			if (pin.netId === null) {
				continue;
			}
			const list = membersByNet.get(pin.netId) ?? [];
			list.push([part.id, pin.pinId] as const);
			membersByNet.set(pin.netId, list);
		}
	}
	const nets: DipTraceNet[] = [...membersByNet].map(([id, members]) =>
		syntheticNet(id, members),
	);
	return {
		sourceType: "DipTrace-Schematic",
		version: "1",
		units: "mm",
		library,
		parts,
		nets,
	};
}

// A quad TL074 (gain-of-2 section A into followers B, C, D in series) as four
// schematic parts of one package. Supplies ride dedicated single-member nets.
export function quadOpampModel(): DipTraceModel {
	const library: DipTraceLibrarySection[] = [
		syntheticSection("SYN-QUAD", "0", "", ["1", "2", "3"]),
		syntheticSection("SYN-QUAD", "1", "", ["4", "5", "6", "7"]),
		syntheticSection("SYN-QUAD", "2", "", ["8", "9", "10", "11"]),
		syntheticSection("SYN-QUAD", "3", "", ["12", "13", "14"]),
		SYN_GROUND_SECTION,
		SYN_CONNECTOR_SECTION,
		SYN_RESISTOR_SECTION,
	];
	// Pads: u0 1(AOUT) 2(AIN-) 3(AIN+); u1 4(VCC) 5(BIN+) 6(BIN-) 7(BOUT);
	// u2 8(COUT) 9(CIN-) 10(CIN+) 11(VEE-side); u3 12(DIN+) 13(DIN-) 14(DOUT).
	const parts: DipTracePart[] = [
		syntheticPart(library, "0", "SYN-QUAD", "0", "IC1", "TL074", ["nAOUT", "nAFB", "nIN"]),
		syntheticPart(library, "1", "SYN-QUAD", "1", "IC1", "TL074", ["nVCC", "nAOUT", "nBF", "nBF"]),
		syntheticPart(library, "2", "SYN-QUAD", "2", "IC1", "TL074", ["nCF", "nCF", "nBF", "nVEE"]),
		syntheticPart(library, "3", "SYN-QUAD", "3", "IC1", "TL074", ["nCF", "nDOUT", "nDOUT"]),
		syntheticPart(library, "4", "SYN-CNCT", "0", "Connector1", "IN", ["nIN"]),
		syntheticPart(library, "5", "SYN-CNCT", "0", "Connector2", "OUT", ["nDOUT"]),
		syntheticPart(library, "6", "SYN-GND", "0", "NetPort1", "", ["n0"]),
		syntheticPart(library, "7", "SYN-RES", "0", "Rg", "10k", ["nAFB", "n0"]),
		syntheticPart(library, "8", "SYN-RES", "0", "Rf", "10k", ["nAOUT", "nAFB"]),
		syntheticPart(library, "9", "SYN-RES", "0", "Rload", "100k", ["nDOUT", "n0"]),
	];
	const membersByNet = new Map<string, Array<readonly [string, string]>>();
	for (const part of parts) {
		for (const pin of part.pins) {
			if (pin.netId === null) {
				continue;
			}
			const list = membersByNet.get(pin.netId) ?? [];
			list.push([part.id, pin.pinId] as const);
			membersByNet.set(pin.netId, list);
		}
	}
	return {
		sourceType: "DipTrace-Schematic",
		version: "1",
		units: "mm",
		library,
		parts,
		nets: [...membersByNet].map(([id, members]) => syntheticNet(id, members)),
	};
}


export function toYaml(
	document: ConvertDipTraceResult["document"],
): string {
	if (document === null) {
		throw new Error("synthetic conversion was refused");
	}
	return serializeInterchangeYaml({
		...document,
		interchangeSchema: "circuit-interchange/v4",
	});
}
