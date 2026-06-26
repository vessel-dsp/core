import type { Knob, KnobStep } from "./types";

const KNOB_POSITION_EPSILON = 1e-9;
const POSITION_ROUNDING_FACTOR = 1_000_000_000_000;

export function buildKnobSteps(
	count: number,
	labels: readonly string[] = [],
): readonly KnobStep[] | undefined {
	if (!Number.isFinite(count)) {
		return undefined;
	}

	const normalizedCount = Math.trunc(count);
	if (normalizedCount < 2) {
		return undefined;
	}

	return Array.from({ length: normalizedCount }, (_, index) => {
		const position = roundPosition(index / (normalizedCount - 1));
		const label = labels[index];
		if (label !== undefined && label.length > 0) {
			return { index, position, label };
		}
		return { index, position };
	});
}

export function nearestKnobStep(
	steps: readonly KnobStep[] | undefined,
	position: number,
): KnobStep | undefined {
	if (steps === undefined || steps.length === 0 || !Number.isFinite(position)) {
		return undefined;
	}

	let nearest = steps[0];
	if (nearest === undefined) {
		return undefined;
	}

	let nearestDistance = Math.abs(position - nearest.position);
	for (const step of steps.slice(1)) {
		const distance = Math.abs(position - step.position);
		if (distance < nearestDistance) {
			nearest = step;
			nearestDistance = distance;
		}
	}
	return nearest;
}

export function snapKnobPosition(
	knob: Pick<Knob, "steps">,
	position: number,
): number {
	const nearest = nearestKnobStep(knob.steps, position);
	return nearest?.position ?? position;
}

export function isKnobPositionOnStep(
	knob: Pick<Knob, "steps">,
	position: number,
): boolean {
	const nearest = nearestKnobStep(knob.steps, position);
	if (nearest === undefined) {
		return true;
	}
	return Math.abs(position - nearest.position) <= KNOB_POSITION_EPSILON;
}

export function knobStepSize(knob: Pick<Knob, "steps">): number | undefined {
	const count = knob.steps?.length ?? 0;
	if (count < 2) {
		return undefined;
	}
	return roundPosition(1 / (count - 1));
}

function roundPosition(value: number): number {
	return (
		Math.round(value * POSITION_ROUNDING_FACTOR) / POSITION_ROUNDING_FACTOR
	);
}
