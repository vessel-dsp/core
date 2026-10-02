// Input choice list: WAV entries plus the always present browser entry.
//
// Nothing here touches a browser global at import time.

import type { InputChoice } from "./types.js";

export type InputListItem = {
	readonly id: string;
	readonly label: string;
	readonly src: string;
};

export const BROWSER_AUDIO_ID = "browser-audio" as const;
export const BROWSER_AUDIO_LABEL = "Browser audio" as const;

// Closed reason for refusing a list that already contains the reserved id.
// Compared by whole-value equality, never by message text.
export type ReservedInputIdReason = "reserved-input-id";

export class ReservedInputIdError extends Error {
	readonly reason: ReservedInputIdReason;
	readonly id: string;

	constructor(id: string) {
		super(`reserved input id: ${id}`);
		this.name = "ReservedInputIdError";
		this.reason = "reserved-input-id";
		this.id = id;
	}
}

// Build the choice list from blog supplied WAV items. Returns the WAV
// choices in order followed by the always present browser audio choice.
// Refuses a list that already contains the reserved id "browser-audio".
export function inputChoicesFromList(
	items: readonly InputListItem[],
): InputChoice[] {
	for (const item of items) {
		if (item.id === BROWSER_AUDIO_ID) {
			throw new ReservedInputIdError(item.id);
		}
	}
	const out: InputChoice[] = [];
	for (const item of items) {
		out.push({ kind: "wav", id: item.id, label: item.label, src: item.src });
	}
	out.push({
		kind: "browser",
		id: BROWSER_AUDIO_ID,
		label: BROWSER_AUDIO_LABEL,
	});
	return out;
}
