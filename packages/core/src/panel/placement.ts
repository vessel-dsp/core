import type {
	CircuitDocument,
	PanelElementPlacement,
	PanelFace,
	Point,
} from "../model/types";

export type MovePanelElementOptions = Readonly<{
	faceId?: string;
	elementId?: string;
	componentId?: string;
	controlId?: string;
	centerMm: Point;
	units?: string;
}>;

/**
 * Updates the physical center for an existing panel element without changing
 * schematic placement or the logical panel grid.
 *
 * This is intentionally a document edit helper: it records the requested
 * `.vdsp` placement and preserves existing fabrication metadata such as
 * `drillDiameterMm`, `partProfileId`, and `locked`. If the target element has
 * no physical block yet, one is created with `units: "mm"` unless another unit
 * is supplied.
 *
 * The helper does not resolve physical conflicts. If the new position overlaps
 * another control, falls outside the enclosure, or is otherwise mechanically
 * invalid, the caller should run the stompbox layout/preview step and inspect
 * diagnostics such as `placement-collision`, `placement-clearance`, and
 * `placement-out-of-bounds` before accepting or serializing the edit.
 */
export function movePanelElement(
	doc: CircuitDocument,
	options: MovePanelElementOptions,
): CircuitDocument {
	if (doc.panel === undefined || !hasPanelElementTarget(options)) {
		return doc;
	}

	let changed = false;
	const faces = doc.panel.faces.map((face) => {
		if (options.faceId !== undefined && face.id !== options.faceId) {
			return face;
		}
		const nextFace = movePanelElementOnFace(face, options);
		if (nextFace !== face) {
			changed = true;
		}
		return nextFace;
	});

	return changed
		? {
				...doc,
				panel: {
					...doc.panel,
					faces,
				},
			}
		: doc;
}

function movePanelElementOnFace(
	face: PanelFace,
	options: MovePanelElementOptions,
): PanelFace {
	let changed = false;
	const elements = face.elements.map((element) => {
		if (!matchesPanelElement(element, options)) {
			return element;
		}
		const nextElement = movePanelElementPlacement(element, options);
		if (nextElement !== element) {
			changed = true;
		}
		return nextElement;
	});

	return changed ? { ...face, elements } : face;
}

function movePanelElementPlacement(
	element: PanelElementPlacement,
	options: MovePanelElementOptions,
): PanelElementPlacement {
	const units = options.units ?? element.physical?.units ?? "mm";
	if (
		element.physical?.units === units &&
		element.physical.centerMm?.x === options.centerMm.x &&
		element.physical.centerMm.y === options.centerMm.y
	) {
		return element;
	}

	return {
		...element,
		physical: {
			...element.physical,
			units,
			centerMm: options.centerMm,
		},
	};
}

function hasPanelElementTarget(options: MovePanelElementOptions): boolean {
	return (
		options.elementId !== undefined ||
		options.componentId !== undefined ||
		options.controlId !== undefined
	);
}

function matchesPanelElement(
	element: PanelElementPlacement,
	options: MovePanelElementOptions,
): boolean {
	if (options.elementId !== undefined) {
		return element.id === options.elementId;
	}
	if (
		options.componentId !== undefined &&
		element.bind.componentId !== options.componentId
	) {
		return false;
	}
	if (
		options.controlId !== undefined &&
		element.bind.controlId !== options.controlId
	) {
		return false;
	}
	return true;
}
