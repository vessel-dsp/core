export type LabelTextBoxLayout = Readonly<{
	lines: readonly string[];
	width: number;
	height: number;
	paddingX: number;
	paddingY: number;
	fontSize: number;
	lineHeight: number;
}>;

const LABEL_TEXTBOX_MAX_CHARS = 52;
const LABEL_TEXTBOX_MIN_WIDTH = 120;
const LABEL_TEXTBOX_MAX_WIDTH = 320;
const LABEL_TEXTBOX_CHAR_WIDTH = 5.8;
const LABEL_TEXTBOX_PADDING_X = 8;
const LABEL_TEXTBOX_PADDING_Y = 6;
const LABEL_TEXTBOX_FONT_SIZE = 10;
const LABEL_TEXTBOX_LINE_HEIGHT = 14;

export function shouldRenderLabelTextBox(
	text: string,
	subtext: string | null,
): boolean {
	return (
		isLongOrMultiline(text) || (subtext !== null && isLongOrMultiline(subtext))
	);
}

export function computeLabelTextBoxLayout(
	text: string,
	subtext: string | null,
): LabelTextBoxLayout {
	const lines = wrapLabelText(labelTextBody(text, subtext));
	const longestLine = Math.max(...lines.map((line) => line.length), 1);
	const width = clamp(
		Math.ceil(
			longestLine * LABEL_TEXTBOX_CHAR_WIDTH + LABEL_TEXTBOX_PADDING_X * 2,
		),
		LABEL_TEXTBOX_MIN_WIDTH,
		LABEL_TEXTBOX_MAX_WIDTH,
	);
	const height =
		LABEL_TEXTBOX_PADDING_Y * 2 + lines.length * LABEL_TEXTBOX_LINE_HEIGHT;

	return {
		lines,
		width,
		height,
		paddingX: LABEL_TEXTBOX_PADDING_X,
		paddingY: LABEL_TEXTBOX_PADDING_Y,
		fontSize: LABEL_TEXTBOX_FONT_SIZE,
		lineHeight: LABEL_TEXTBOX_LINE_HEIGHT,
	};
}

function isLongOrMultiline(value: string): boolean {
	return value.includes("\n") || value.length > LABEL_TEXTBOX_MAX_CHARS;
}

function labelTextBody(text: string, subtext: string | null): string {
	if (subtext === null) {
		return text;
	}
	return `${text}\n${subtext}`;
}

function wrapLabelText(text: string): readonly string[] {
	const lines = text.split(/\r?\n/).flatMap((line) => wrapLabelLine(line));
	return lines.length === 0 ? [""] : lines;
}

function wrapLabelLine(line: string): readonly string[] {
	if (line.length <= LABEL_TEXTBOX_MAX_CHARS) {
		return [line];
	}

	const wrapped: string[] = [];
	let rest = line.trimEnd();
	while (rest.length > LABEL_TEXTBOX_MAX_CHARS) {
		const breakAt = findWrapIndex(rest);
		wrapped.push(rest.slice(0, breakAt).trimEnd());
		rest = rest.slice(breakAt).trimStart();
	}
	wrapped.push(rest);
	return wrapped;
}

function findWrapIndex(text: string): number {
	const search = text.slice(0, LABEL_TEXTBOX_MAX_CHARS + 1);
	const spaceIndex = search.lastIndexOf(" ");
	if (spaceIndex > 0) {
		return spaceIndex;
	}
	return LABEL_TEXTBOX_MAX_CHARS;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}
