/**
 * DipTrace `.dchxml` schematic parser (layer A: typed model + parity).
 *
 * Produces a loss-free typed reading of a DipTrace schematic XML export:
 * library sections keyed by `(ComponentStyle, Part Id)`, schematic parts with
 * their authored identity fields, every pin joined to its library pin
 * (pad number, pad id, pin name, electric type) and its net, and nets by pin
 * membership. Connectivity comes from pin membership only; net display names
 * in this corpus are locale placeholders and are never evidence.
 *
 * XML is read with a small dependency-free scanner in the style of
 * `formats/schx/parser.ts` (regex tokeniser, explicit stack). No new package.
 */

export type DipTraceLibraryPin = Readonly<{
	/** Pin `Id` within its library section. */
	pinId: string;
	/** Library `PadNumber` text (may be numeric, lettered, or empty). */
	padNumber: string;
	/** Library `PadId` attribute (footprint pad binding, may be empty). */
	padId: string;
	/** Library pin `Name` text, whitespace-collapsed, `:` replaced with `_`. */
	name: string;
	/** Library pin `ElectricType` attribute verbatim. */
	electricType: string;
	/** Library pin `X`/`Y` attributes (symbol-local coordinates, may be empty). */
	x: string;
	y: string;
}>;

export type DipTraceLibraryShapePoint = Readonly<{ x: number; y: number }>;

export type DipTraceLibraryShape = Readonly<{
	/** `Shape` `Id` within its library section. */
	shapeId: string;
	/** `Shape` `Type` attribute verbatim (e.g. `Line`). */
	shapeType: string;
	/** `Points` children in declaration order (empty when unparseable). */
	points: readonly DipTraceLibraryShapePoint[];
}>;

export type DipTraceLibrarySection = Readonly<{
	/** Owning library `Component`'s `ComponentStyle` (e.g. `CompType17`). */
	style: string;
	/** Library `Part`'s `Id` (the section within a multi-section symbol). */
	sectionId: string;
	/** Library part `Name` text (footprint or symbol name, may be empty). */
	name: string;
	/** Library part `PartName` text (e.g. `Part 1`). */
	partName: string;
	/** Library part `Value` text (default value text, may be empty). */
	value: string;
	/** Library part `Category` index attribute, or null when absent. */
	categoryIndex: string | null;
	/** Pins in library declaration order. */
	pins: readonly DipTraceLibraryPin[];
	/** Symbol drawing shapes in declaration order (empty when none). */
	shapes: readonly DipTraceLibraryShape[];
}>;

export type DipTracePartPin = Readonly<{
	/** Schematic `Pin`'s `Id` (joins to the library pin). */
	pinId: string;
	/** Schematic `Pin`'s `NetId`, or null when the attribute is absent. */
	netId: string | null;
	/** Resolved pad token: library `PadNumber`, or the pin `Id` fallback. */
	padNumber: string;
	/** Library `PadId` attribute, or empty when the library gives none. */
	padId: string;
	/** Library pin `Name` (cleaned), or empty when the library gives none. */
	name: string;
	/** Library pin `ElectricType` attribute, or empty when unknown. */
	electricType: string;
	/** True when no library pin exists for this schematic pin. */
	libraryPinMissing: boolean;
}>;

export type DipTracePart = Readonly<{
	/** Schematic `Part`'s `Id` (numeric string, unique in the document). */
	id: string;
	/** Schematic `Part`'s `ComponentStyle` (joins to the library). */
	style: string;
	/** Schematic `Part`'s `ComponentPart` (joins to the library section). */
	section: string;
	/** Authored reference designator (e.g. `R1`, `NetPort14`). */
	refDes: string;
	/** Authored part designator within a shared RefDes (e.g. `1`, `2`). */
	partRefDes: string;
	/** Authored part name (e.g. `Part 1`). */
	partName: string;
	/** Authored value text, passed through unchanged. */
	value: string;
	/** Authored name text (footprint/symbol/instance label, may be empty). */
	name: string;
	/** Authored base name text (may be empty). */
	baseName: string;
	/** Authored manufacturer text (may be empty; pot value/taper marking lives here). */
	manufacturer: string;
	/** Authored datasheet text (may be empty). */
	datasheet: string;
	/** Placed part's library `<Path>` text (unquoted), or empty when absent. */
	libPath: string;
	/** Schematic part `Category` index attribute, or null when absent. */
	categoryIndex: string | null;
	/** Schematic `Sheet` attribute (all `0` in the surveyed corpus). */
	sheet: string;
	/** Schematic `X`/`Y` placement text (kept as provenance, unused). */
	x: string;
	y: string;
	/** Pins in schematic declaration order. */
	pins: readonly DipTracePartPin[];
}>;

export type DipTraceNetMember = Readonly<{
	/** Referenced schematic `Part` `Id`. */
	partId: string;
	/** Referenced schematic `Pin` `Id`. */
	pinId: string;
}>;

export type DipTraceNet = Readonly<{
	/** `Net`'s `Id`. */
	id: string;
	/** `Net`'s `Name` text (placeholder in the surveyed corpus). */
	name: string;
	/** `Net`'s `NetClass` attribute. */
	netClass: string;
	/** `Net`'s `HiddenId` attribute. */
	hiddenId: string;
	/** Members in net declaration order. */
	members: readonly DipTraceNetMember[];
}>;

export type DipTraceModel = Readonly<{
	/** Root `Source` `Type` attribute (expected `DipTrace-Schematic`). */
	sourceType: string;
	/** Root `Source` `Version` attribute. */
	version: string;
	/** Root `Source` `Units` attribute. */
	units: string;
	/** Library sections in declaration order. */
	library: readonly DipTraceLibrarySection[];
	/** Schematic parts in declaration order. */
	parts: readonly DipTracePart[];
	/** Nets in declaration order. */
	nets: readonly DipTraceNet[];
}>;

export type DipTracePadLabelMismatch = Readonly<{
	/** Owning part's RefDes. */
	refDes: string;
	/** Owning part's schematic `Part` `Id`. */
	partId: string;
	/** Schematic `Pin` `Id`. */
	pinId: string;
	/** Library pad token (a single letter that disagrees with the pin name). */
	pad: string;
	/** Library symbol pin name (the role evidence). */
	name: string;
}>;

type XmlNode = {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
};

const TAG_REGEX = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR_REGEX = /([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;
const COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const PROLOG_REGEX = /<\?[\s\S]*?\?>/g;

function decodeXmlEntities(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

function parseXmlAttributes(input: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const match of input.matchAll(ATTR_REGEX)) {
		const name = match[1];
		const raw = match[2];
		if (name === undefined || raw === undefined) {
			continue;
		}
		out[name] = decodeXmlEntities(raw.slice(1, -1));
	}
	return out;
}

function parseXmlDocument(xml: string): XmlNode {
	const normalized = xml
		.replace(/^﻿/, "")
		.replace(PROLOG_REGEX, "")
		.replace(COMMENT_REGEX, "");
	const root: XmlNode = { tag: "", attrs: {}, children: [], text: "" };
	const stack: XmlNode[] = [root];
	let cursor = 0;
	let sawRoot = false;
	for (const match of normalized.matchAll(TAG_REGEX)) {
		const matchIndex = match.index ?? 0;
		const text = normalized.slice(cursor, matchIndex);
		if (text.length > 0) {
			const top = stack[stack.length - 1];
			if (top !== undefined) {
				top.text += decodeXmlEntities(text);
			}
		}
		cursor = matchIndex + match[0].length;
		const closing = match[1] === "/";
		const tag = match[2] ?? "";
		const attrText = match[3] ?? "";
		const selfClosing = match[4] === "/";
		if (closing) {
			const top = stack.pop();
			if (top === undefined || top.tag !== tag) {
				throw new Error(
					`not a DipTrace schematic: mismatched closing tag </${tag}>`,
				);
			}
			continue;
		}
		const node: XmlNode = {
			tag,
			attrs: parseXmlAttributes(attrText),
			children: [],
			text: "",
		};
		const parent = stack[stack.length - 1];
		if (parent === undefined) {
			throw new Error(
				`not a DipTrace schematic: element <${tag}> outside the root`,
			);
		}
		if (parent === root) {
			if (sawRoot) {
				throw new Error(
					`not a DipTrace schematic: more than one root element`,
				);
			}
			sawRoot = true;
		}
		parent.children.push(node);
		if (!selfClosing) {
			stack.push(node);
		}
	}
	if (stack.length !== 1) {
		throw new Error(`not a DipTrace schematic: unterminated element`);
	}
	const element = root.children[0];
	if (element === undefined) {
		throw new Error(`not a DipTrace schematic: empty document`);
	}
	return element;
}

function childText(node: XmlNode, tag: string): string {
	const child = node.children.find((entry) => entry.tag === tag);
	return child?.text ?? "";
}

function childAttr(
	node: XmlNode,
	tag: string,
	attr: string,
): string | null {
	const child = node.children.find((entry) => entry.tag === tag);
	const value = child?.attrs[attr];
	return value === undefined ? null : value;
}

/**
 * A placed part's library path. `<LibPath>` holds nested `<Path>` and
 * `<Var>` children (each single-quoted), never direct text, so reading the
 * element's own text always yields `""`. `<Path>` is the resolved path;
 * `<Var>` may carry an install-root variable (`%standardlibs%`) instead.
 */
function readLibPath(part: XmlNode): string {
	const libPath = part.children.find((entry) => entry.tag === "LibPath");
	if (libPath === undefined) {
		return "";
	}
	const path = libPath.children.find((entry) => entry.tag === "Path");
	if (path !== undefined) {
		return unquoteLibPath(path.text);
	}
	return "";
}

function unquoteLibPath(text: string): string {
	const trimmed = text.trim();
	if (
		trimmed.length >= 2 &&
		trimmed.startsWith("'") &&
		trimmed.endsWith("'")
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * The oracle's pin-name cleaning, mirrored exactly: collapse whitespace and
 * replace `:` with `_` so no pin row contains a colon.
 */
export function cleanDipTracePinName(value: string | null | undefined): string {
	return (value ?? "").split(/\s+/).join(" ").trim().replaceAll(":", "_");
}

function libraryPinKey(style: string, section: string, pinId: string): string {
	return [style, section, pinId].join("\0");
}

/**
 * The root `<Source>` element's `Type` attribute, or null when the text is
 * not a DipTrace-shaped document. Same scanner the parser uses; never
 * throws, so content sniffing cannot fail a non-XML source.
 */
export function readDipTraceSourceType(xml: string): string | null {
	try {
		const root = parseXmlDocument(xml);
		if (root.tag !== "Source") {
			return null;
		}
		return root.attrs.Type ?? null;
	} catch {
		return null;
	}
}

/**
 * The pad token of a capacitor symbol's marked (+) plate, read from the
 * symbol's own drawing geometry, or null when the symbol states nothing.
 *
 * The discriminating feature is a plus glyph drawn as two crossing line
 * segments, with the marked plate the nearest of the remaining segments:
 * exactly two segments cross at each other's midpoints, the other two do
 * not, and exactly one of those is strictly nearest the crossing. Anything
 * else (arcs, text, rectangles, a missing or tied nearest plate, pin
 * coordinates absent) is not a plus marking, and the answer stays null.
 * Lengths are never compared: only crossing and nearness, so symbol scale
 * cannot move the answer. Library-relative throughout, so placed-part
 * mirroring and rotation cannot change it either.
 */
export function dipTraceCapacitorPositivePad(
	section: DipTraceLibrarySection,
): string | null {
	if (section.pins.length !== 2) {
		return null;
	}
	const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
	for (const shape of section.shapes) {
		if (shape.shapeType !== "Line" || shape.points.length !== 2) {
			return null;
		}
		const [a, b] = shape.points as readonly [
			DipTraceLibraryShapePoint,
			DipTraceLibraryShapePoint,
		];
		if (a === undefined || b === undefined) {
			return null;
		}
		segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
	}
	if (segments.length !== 4) {
		return null;
	}
	const EPS = 1e-9;
	const isHorizontal = (s: (typeof segments)[number]) =>
		Math.abs(s.y1 - s.y2) < EPS;
	const isVertical = (s: (typeof segments)[number]) =>
		Math.abs(s.x1 - s.x2) < EPS;
	// The plus pair: one horizontal, one vertical, crossing at midpoints.
	const crossings: { cross: { x: number; y: number }; rest: [number, number] }[] = [];
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			const a = segments[i]!;
			const b = segments[j]!;
			const horizontal = isHorizontal(a) ? a : isHorizontal(b) ? b : null;
			const vertical = isVertical(a) ? a : isVertical(b) ? b : null;
			if (horizontal === null || vertical === null) {
				continue;
			}
			const midX = (horizontal.x1 + horizontal.x2) / 2;
			const midY = (vertical.y1 + vertical.y2) / 2;
			if (
				Math.abs(vertical.x1 - midX) < EPS &&
				Math.abs(horizontal.y1 - midY) < EPS
			) {
				const rest: [number, number] = [0, 1, 2, 3].filter(
					(index) => index !== i && index !== j,
				) as [number, number];
				crossings.push({ cross: { x: midX, y: midY }, rest });
			}
		}
	}
	if (crossings.length !== 1) {
		return null;
	}
	const { cross, rest } = crossings[0]!;
	const segA = segments[rest[0]];
	const segB = segments[rest[1]];
	if (segA === undefined || segB === undefined) {
		return null;
	}
	const plates = [segA, segB] as const;
	// The two plates must not themselves cross (parallel, disjoint plates).
	const [p0, p1] = plates;
	if (
		(isHorizontal(p0) && isHorizontal(p1) && Math.abs(p0.y1 - p1.y1) < EPS) ||
		(isVertical(p0) && isVertical(p1) && Math.abs(p0.x1 - p1.x1) < EPS)
	) {
		// Collinear overlap would be one plate, not two; parallel distinct is fine.
		if (
			(isHorizontal(p0) &&
				isHorizontal(p1) &&
				Math.abs(p0.y1 - p1.y1) < EPS &&
				segmentsOverlap1D(p0.x1, p0.x2, p1.x1, p1.x2)) ||
			(isVertical(p0) &&
				isVertical(p1) &&
				Math.abs(p0.x1 - p1.x1) < EPS &&
				segmentsOverlap1D(p0.y1, p0.y2, p1.y1, p1.y2))
		) {
			return null;
		}
	}
	const d0 = pointSegmentDistance(cross.x, cross.y, p0);
	const d1 = pointSegmentDistance(cross.x, cross.y, p1);
	if (!(d0 < d1) && !(d1 < d0)) {
		return null;
	}
	const winner = d0 < d1 ? p0 : p1;
	// The pin the winning plate belongs to, by nearness to the plate.
	const pinDistances = section.pins.map((pin) => {
		const x = Number(pin.x);
		const y = Number(pin.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return null;
		}
		return pointSegmentDistance(x, y, winner);
	});
	if (pinDistances.some((distance) => distance === null)) {
		return null;
	}
	const distances = pinDistances as number[];
	let best = 0;
	for (let i = 1; i < distances.length; i++) {
		if (distances[i]! < distances[best]!) {
			best = i;
		}
	}
	if (distances.filter((distance) => distance === distances[best]).length !== 1) {
		return null;
	}
	const pin = section.pins[best];
	if (pin === undefined) {
		return null;
	}
	return pin.padNumber.length > 0 ? pin.padNumber : pin.pinId;
}

function segmentsOverlap1D(a1: number, a2: number, b1: number, b2: number): boolean {
	const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
	const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
	return hi > lo;
}

function pointSegmentDistance(
	px: number,
	py: number,
	segment: { x1: number; y1: number; x2: number; y2: number },
): number {
	const dx = segment.x2 - segment.x1;
	const dy = segment.y2 - segment.y1;
	const denom = dx * dx + dy * dy;
	if (denom === 0) {
		return Math.hypot(px - segment.x1, py - segment.y1);
	}
	const t = Math.max(
		0,
		Math.min(
			1,
			((px - segment.x1) * dx + (py - segment.y1) * dy) / denom,
		),
	);
	return Math.hypot(segment.x1 + t * dx - px, segment.y1 + t * dy - py);
}

/**
 * Parse a DipTrace `.dchxml` schematic export into the typed layer-A model.
 * Throws when the document is not a DipTrace schematic. Never throws for
 * unknown library symbols or unconnected pins: those are model facts, and
 * the parity harness reports them.
 */
export function parseDipTraceSchematic(xml: string): DipTraceModel {
	const root = parseXmlDocument(xml);
	if (root.tag !== "Source") {
		throw new Error(
			`not a DipTrace schematic: root element is <${root.tag}>, expected <Source>`,
		);
	}
	const sourceType = root.attrs.Type ?? "";
	if (sourceType !== "DipTrace-Schematic") {
		throw new Error(
			`not a DipTrace schematic: Source Type is "${sourceType}"`,
		);
	}
	const version = root.attrs.Version ?? "";
	const units = root.attrs.Units ?? "";

	const libraryRoot = root.children.find(
		(node) =>
			node.tag === "Library" &&
			node.attrs.Type === "DipTrace-ComponentLibrary",
	);
	if (libraryRoot === undefined) {
		throw new Error(
			`not a DipTrace schematic: missing Library Type="DipTrace-ComponentLibrary"`,
		);
	}
	const schematicRoot = root.children.find((node) => node.tag === "Schematic");
	if (schematicRoot === undefined) {
		throw new Error(`not a DipTrace schematic: missing <Schematic>`);
	}

	const library: DipTraceLibrarySection[] = [];
	const libraryPins = new Map<string, DipTraceLibraryPin>();
	const libraryComponents = libraryRoot.children.find(
		(node) => node.tag === "Components",
	);
	if (libraryComponents !== undefined) {
		for (const component of libraryComponents.children) {
			if (component.tag !== "Component") {
				continue;
			}
			const style = component.attrs.ComponentStyle ?? "";
			for (const part of component.children) {
				if (part.tag !== "Part") {
					continue;
				}
				const sectionId = part.attrs.Id ?? "";
				const pins: DipTraceLibraryPin[] = [];
				const pinsNode = part.children.find((node) => node.tag === "Pins");
				if (pinsNode !== undefined) {
					for (const pin of pinsNode.children) {
						if (pin.tag !== "Pin") {
							continue;
						}
						const pinId = pin.attrs.Id ?? "";
						const entry: DipTraceLibraryPin = {
							pinId,
							padNumber: childText(pin, "PadNumber").trim(),
							padId: pin.attrs.PadId ?? "",
							name: cleanDipTracePinName(childText(pin, "Name")),
							electricType: pin.attrs.ElectricType ?? "",
							x: pin.attrs.X ?? "",
							y: pin.attrs.Y ?? "",
						};
						pins.push(entry);
						libraryPins.set(libraryPinKey(style, sectionId, pinId), entry);
					}
				}
				const shapes: DipTraceLibraryShape[] = [];
				const shapesNode = part.children.find(
					(node) => node.tag === "Shapes",
				);
				if (shapesNode !== undefined) {
					for (const shape of shapesNode.children) {
						if (shape.tag !== "Shape") {
							continue;
						}
						const points: DipTraceLibraryShapePoint[] = [];
						const pointsNode = shape.children.find(
							(node) => node.tag === "Points",
						);
						if (pointsNode !== undefined) {
							for (const point of pointsNode.children) {
								if (point.tag !== "Point") {
									continue;
								}
								const x = Number(point.attrs.X ?? "");
								const y = Number(point.attrs.Y ?? "");
								if (Number.isFinite(x) && Number.isFinite(y)) {
									points.push({ x, y });
								}
							}
						}
						shapes.push({
							shapeId: shape.attrs.Id ?? "",
							shapeType: shape.attrs.Type ?? "",
							points,
						});
					}
				}
				library.push({
					style,
					sectionId,
					name: childText(part, "Name").trim(),
					partName: childText(part, "PartName").trim(),
					value: childText(part, "Value").trim(),
					categoryIndex: childAttr(part, "Category", "Index"),
					pins,
					shapes,
				});
			}
		}
	}

	const parts: DipTracePart[] = [];
	const schematicComponents = schematicRoot.children.find(
		(node) => node.tag === "Components",
	);
	if (schematicComponents === undefined) {
		throw new Error(`not a DipTrace schematic: missing Schematic <Components>`);
	}
	for (const part of schematicComponents.children) {
		if (part.tag !== "Part") {
			continue;
		}
		const style = part.attrs.ComponentStyle ?? "";
		const section = part.attrs.ComponentPart ?? "";
		const pins: DipTracePartPin[] = [];
		const pinsNode = part.children.find((node) => node.tag === "Pins");
		if (pinsNode !== undefined) {
			for (const pin of pinsNode.children) {
				if (pin.tag !== "Pin") {
					continue;
				}
				const pinId = pin.attrs.Id ?? "";
				const netId = pin.attrs.NetId;
				const libraryPin = libraryPins.get(
					libraryPinKey(style, section, pinId),
				);
				pins.push({
					pinId,
					netId: netId === undefined ? null : netId,
					padNumber:
						libraryPin === undefined || libraryPin.padNumber.length === 0
							? pinId
							: libraryPin.padNumber,
					padId: libraryPin?.padId ?? "",
					name: libraryPin?.name ?? "",
					electricType: libraryPin?.electricType ?? "",
					libraryPinMissing: libraryPin === undefined,
				});
			}
		}
		parts.push({
			id: part.attrs.Id ?? "",
			style,
			section,
			refDes: childText(part, "RefDes").trim() || `P${part.attrs.Id ?? ""}`,
			partRefDes: childText(part, "PartRefDes").trim(),
			partName: childText(part, "PartName").trim(),
			value: childText(part, "Value").trim(),
			name: childText(part, "Name").trim(),
			baseName: childText(part, "BaseName").trim(),
			manufacturer: childText(part, "Manufacturer").trim(),
			datasheet: childText(part, "Datasheet").trim(),
			libPath: readLibPath(part),
			categoryIndex: childAttr(part, "Category", "Index"),
			sheet: part.attrs.Sheet ?? "",
			x: part.attrs.X ?? "",
			y: part.attrs.Y ?? "",
			pins,
		});
	}

	const nets: DipTraceNet[] = [];
	const netsNode = schematicRoot.children.find((node) => node.tag === "Nets");
	if (netsNode === undefined) {
		throw new Error(`not a DipTrace schematic: missing Schematic <Nets>`);
	}
	for (const net of netsNode.children) {
		if (net.tag !== "Net") {
			continue;
		}
		const members: DipTraceNetMember[] = [];
		const pinsNode = net.children.find((node) => node.tag === "Pins");
		if (pinsNode !== undefined) {
			for (const item of pinsNode.children) {
				const partId = item.attrs.Part;
				const pinId = item.attrs.Pin;
				if (partId === undefined || pinId === undefined) {
					continue;
				}
				members.push({ partId, pinId });
			}
		}
		nets.push({
			id: net.attrs.Id ?? "",
			name: childText(net, "Name").trim(),
			netClass: net.attrs.NetClass ?? "",
			hiddenId: net.attrs.HiddenId ?? "",
			members,
		});
	}

	return { sourceType, version, units, library, parts, nets };
}

const ELECTRODE_LETTER_PAD = /^[A-Z]$/;

/**
 * Symbol-vs-footprint disagreements: a lettered pad token names an electrode,
 * so `pad C` on a symbol pin named `E` is evidence the two disagree about
 * which electrode the pin is. Numeric and multi-character pads are positions,
 * not roles, and are never reported.
 *
 * Returns one entry per disagreeing pin (e.g. the Tone Bender MKI / Sunface
 * Ge PNPs whose pad `C` is wired to symbol pin `E`). Uses the symbol pin
 * name for the role and records the pad label as provenance; it never decides
 * which side the drawing supports.
 */
export function findDipTracePadLabelMismatches(
	model: DipTraceModel,
): readonly DipTracePadLabelMismatch[] {
	const out: DipTracePadLabelMismatch[] = [];
	for (const part of model.parts) {
		for (const pin of part.pins) {
			if (pin.libraryPinMissing) {
				continue;
			}
			if (!ELECTRODE_LETTER_PAD.test(pin.padNumber)) {
				continue;
			}
			if (pin.padNumber === pin.name) {
				continue;
			}
			out.push({
				refDes: part.refDes,
				partId: part.id,
				pinId: pin.pinId,
				pad: pin.padNumber,
				name: pin.name,
			});
		}
	}
	return out;
}
