import type { CircuitDocument } from "../model/types";
import { applyDocumentCommand, type DocumentCommand } from "./commands";

export type EditorState = Readonly<{
	document: CircuitDocument;
	selectedId: string | null;
	selectedWireId: string | null;
	past: readonly CircuitDocument[];
	future: readonly CircuitDocument[];
}>;

export type EditorCommand =
	| DocumentCommand
	| Readonly<{ type: "replace-document"; document: CircuitDocument }>
	| Readonly<{ type: "select"; componentId: string | null }>
	| Readonly<{ type: "select-wire"; wireId: string | null }>
	| Readonly<{ type: "undo" }>
	| Readonly<{ type: "redo" }>;

const HISTORY_LIMIT = 200;

export function createEditorState(document: CircuitDocument): EditorState {
	return {
		document,
		selectedId: null,
		selectedWireId: null,
		past: [],
		future: [],
	};
}

export function applyEditorCommand(
	state: EditorState,
	command: EditorCommand,
): EditorState {
	switch (command.type) {
		case "select":
			if (
				state.selectedId === command.componentId &&
				state.selectedWireId === null
			) {
				return state;
			}
			return {
				...state,
				selectedId: command.componentId,
				selectedWireId: null,
			};
		case "select-wire":
			if (
				state.selectedWireId === command.wireId &&
				state.selectedId === null
			) {
				return state;
			}
			return { ...state, selectedWireId: command.wireId, selectedId: null };
		case "replace-document":
			return replaceDocument(state, command.document);
		case "undo":
			return undo(state);
		case "redo":
			return redo(state);
		default:
			return applyAndPush(state, command);
	}
}

export function canUndo(state: EditorState): boolean {
	return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
	return state.future.length > 0;
}

export function resetEditorState(document: CircuitDocument): EditorState {
	return createEditorState(document);
}

function applyAndPush(
	state: EditorState,
	command: DocumentCommand,
): EditorState {
	const nextDocument = applyDocumentCommand(state.document, command);
	if (nextDocument === state.document) {
		return state;
	}
	const past = [...state.past, state.document].slice(-HISTORY_LIMIT);
	const selectedId =
		command.type === "delete-component" &&
		state.selectedId === command.componentId
			? null
			: state.selectedId;
	const selectedWireId = wireSelectionAfterCommand(
		state.selectedWireId,
		command,
	);
	return {
		document: nextDocument,
		selectedId,
		selectedWireId,
		past,
		future: [],
	};
}

function replaceDocument(
	state: EditorState,
	document: CircuitDocument,
): EditorState {
	if (document === state.document) {
		return state;
	}
	const past = [...state.past, state.document].slice(-HISTORY_LIMIT);
	return {
		document,
		selectedId: null,
		selectedWireId: null,
		past,
		future: [],
	};
}

function wireSelectionAfterCommand(
	selectedWireId: string | null,
	command: DocumentCommand,
): string | null {
	if (selectedWireId === null) {
		return null;
	}
	if (command.type === "delete-wire" && command.wireId === selectedWireId) {
		return null;
	}
	if (
		command.type === "delete-wires" &&
		command.wireIds.includes(selectedWireId)
	) {
		return null;
	}
	return selectedWireId;
}

function undo(state: EditorState): EditorState {
	const previous = state.past[state.past.length - 1];
	if (previous === undefined) {
		return state;
	}
	return {
		document: previous,
		selectedId: state.selectedId,
		selectedWireId: state.selectedWireId,
		past: state.past.slice(0, -1),
		future: [state.document, ...state.future],
	};
}

function redo(state: EditorState): EditorState {
	const next = state.future[0];
	if (next === undefined) {
		return state;
	}
	return {
		document: next,
		selectedId: state.selectedId,
		selectedWireId: state.selectedWireId,
		past: [...state.past, state.document],
		future: state.future.slice(1),
	};
}
