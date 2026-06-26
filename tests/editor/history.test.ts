import { describe, expect, test } from "bun:test";
import {
	applyEditorCommand,
	canRedo,
	canUndo,
	createEditorState,
} from "../../packages/core/src/editor/history";
import {
	EMPTY_DOCUMENT,
	type Component,
	type ComponentKind,
} from "../../packages/core/src/model/types";

function makeComponent(
	id: string,
	kind: ComponentKind = "resistor",
): Component {
	return {
		id,
		kind,
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: [],
		properties: {},
		sourceTypeName: null,
	};
}

describe("applyEditorCommand", () => {
	test("select updates selectedId without touching history", () => {
		const state = createEditorState(EMPTY_DOCUMENT);
		const next = applyEditorCommand(state, {
			type: "select",
			componentId: "R1",
		});
		expect(next.selectedId).toBe("R1");
		expect(next.past).toHaveLength(0);
		expect(next.future).toHaveLength(0);
	});

	test("select with same id returns same reference", () => {
		const state = { ...createEditorState(EMPTY_DOCUMENT), selectedId: "R1" };
		const next = applyEditorCommand(state, {
			type: "select",
			componentId: "R1",
		});
		expect(next).toBe(state);
	});

	test("a document mutation pushes to history", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const next = applyEditorCommand(initial, {
			type: "rename-component",
			componentId: "R1",
			newName: "Rload",
		});
		expect(next.document.components[0]?.name).toBe("Rload");
		expect(canUndo(next)).toBe(true);
		expect(canRedo(next)).toBe(false);
	});

	test("replace-document swaps the whole document and remains undoable", () => {
		const originalDocument = {
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
			wires: [
				{
					id: "wire-1",
					endpoints: [
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
					],
				},
			] as const,
		};
		const replacementDocument = {
			...EMPTY_DOCUMENT,
			metadata: { name: "Raw edit", description: "", partNumber: "" },
			components: [makeComponent("C1", "capacitor")],
		};
		const initial = {
			...createEditorState(originalDocument),
			selectedId: "R1",
			selectedWireId: "wire-1",
			future: [EMPTY_DOCUMENT],
		};

		const next = applyEditorCommand(initial, {
			type: "replace-document",
			document: replacementDocument,
		});

		expect(next.document).toBe(replacementDocument);
		expect(next.selectedId).toBeNull();
		expect(next.selectedWireId).toBeNull();
		expect(canUndo(next)).toBe(true);
		expect(canRedo(next)).toBe(false);

		const undone = applyEditorCommand(next, { type: "undo" });
		expect(undone.document).toBe(originalDocument);
	});

	test("replace-document returns the same state when the document is unchanged", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const next = applyEditorCommand(initial, {
			type: "replace-document",
			document: initial.document,
		});

		expect(next).toBe(initial);
	});

	test("undo restores the previous document", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const renamed = applyEditorCommand(initial, {
			type: "rename-component",
			componentId: "R1",
			newName: "Rload",
		});
		const undone = applyEditorCommand(renamed, { type: "undo" });
		expect(undone.document.components[0]?.name).toBe("R1");
		expect(canRedo(undone)).toBe(true);
	});

	test("redo replays the undone change", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const renamed = applyEditorCommand(initial, {
			type: "rename-component",
			componentId: "R1",
			newName: "Rload",
		});
		const undone = applyEditorCommand(renamed, { type: "undo" });
		const redone = applyEditorCommand(undone, { type: "redo" });
		expect(redone.document.components[0]?.name).toBe("Rload");
	});

	test("a new edit clears the redo future", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const renamed = applyEditorCommand(initial, {
			type: "rename-component",
			componentId: "R1",
			newName: "Rload",
		});
		const undone = applyEditorCommand(renamed, { type: "undo" });
		const branched = applyEditorCommand(undone, {
			type: "rename-component",
			componentId: "R1",
			newName: "Rbias",
		});
		expect(canRedo(branched)).toBe(false);
		expect(branched.document.components[0]?.name).toBe("Rbias");
	});

	test("delete-component clears matching selection", () => {
		const initial = {
			...createEditorState({
				...EMPTY_DOCUMENT,
				components: [makeComponent("R1")],
			}),
			selectedId: "R1",
		};
		const next = applyEditorCommand(initial, {
			type: "delete-component",
			componentId: "R1",
		});
		expect(next.selectedId).toBeNull();
	});

	test("move-component updates origin and pushes history", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [
				{
					...makeComponent("R1"),
					terminals: [{ name: "a", position: { x: 0, y: 0 } }],
				},
			],
		});
		const next = applyEditorCommand(initial, {
			type: "move-component",
			componentId: "R1",
			origin: { x: 40, y: 60 },
		});
		expect(next.document.components[0]?.origin).toEqual({ x: 40, y: 60 });
		expect(canUndo(next)).toBe(true);
	});

	test("tidy-layout pushes history when it changes component positions", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1"),
				{ ...makeComponent("R2"), origin: { x: 10, y: 0 } },
			],
		});

		const next = applyEditorCommand(initial, { type: "tidy-layout" });

		expect(next.document.components[1]?.origin).not.toEqual({ x: 10, y: 0 });
		expect(canUndo(next)).toBe(true);
	});

	test("no-op commands return the same state reference", () => {
		const initial = createEditorState({
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1")],
		});
		const next = applyEditorCommand(initial, {
			type: "rename-component",
			componentId: "R1",
			newName: "R1",
		});
		expect(next).toBe(initial);
	});

	test("select-wire sets selectedWireId and clears component selection", () => {
		const initial = { ...createEditorState(EMPTY_DOCUMENT), selectedId: "R1" };
		const next = applyEditorCommand(initial, {
			type: "select-wire",
			wireId: "wire-1",
		});
		expect(next.selectedWireId).toBe("wire-1");
		expect(next.selectedId).toBeNull();
	});

	test("select clears any wire selection", () => {
		const initial = {
			...createEditorState(EMPTY_DOCUMENT),
			selectedWireId: "wire-1",
		};
		const next = applyEditorCommand(initial, {
			type: "select",
			componentId: "R1",
		});
		expect(next.selectedId).toBe("R1");
		expect(next.selectedWireId).toBeNull();
	});

	test("delete-wire clears the selection when it deletes the selected wire", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			wires: [
				{
					id: "wire-1",
					endpoints: [
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
					],
				},
			] as const,
		};
		const initial = { ...createEditorState(doc), selectedWireId: "wire-1" };
		const next = applyEditorCommand(initial, {
			type: "delete-wire",
			wireId: "wire-1",
		});
		expect(next.document.wires).toHaveLength(0);
		expect(next.selectedWireId).toBeNull();
	});

	test("delete-wire preserves an unrelated wire selection", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			wires: [
				{
					id: "wire-1",
					endpoints: [
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
					],
				},
				{
					id: "wire-2",
					endpoints: [
						{ x: 0, y: 10 },
						{ x: 10, y: 10 },
					],
				},
			] as const,
		};
		const initial = { ...createEditorState(doc), selectedWireId: "wire-2" };
		const next = applyEditorCommand(initial, {
			type: "delete-wire",
			wireId: "wire-1",
		});
		expect(next.selectedWireId).toBe("wire-2");
	});

	test("delete-wires clears the selection when the batch contains the selected wire", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			wires: [
				{
					id: "wire-1",
					endpoints: [
						{ x: 0, y: 0 },
						{ x: 10, y: 0 },
					],
				},
				{
					id: "wire-2",
					endpoints: [
						{ x: 10, y: 0 },
						{ x: 10, y: 10 },
					],
				},
			] as const,
		};
		const initial = { ...createEditorState(doc), selectedWireId: "wire-1" };
		const next = applyEditorCommand(initial, {
			type: "delete-wires",
			wireIds: ["wire-1", "wire-2"],
		});
		expect(next.document.wires).toHaveLength(0);
		expect(next.selectedWireId).toBeNull();
	});
});
