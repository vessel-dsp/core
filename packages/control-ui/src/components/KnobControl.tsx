import type {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Knob } from '@vessel-dsp/core';
import { knobStepSize } from '@vessel-dsp/core';
import { formatControlValue, snapControlPosition } from '../controls';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';
import { ControlFrame } from './ControlFrame';

const KNOB_SWEEP_DEGREES = 300;
const KNOB_START_DEGREES = -150;
const KNOB_DRAG_PIXELS_PER_RANGE = 160;

type KnobDragState = {
    pointerId: number;
    startX: number;
    startPosition: number;
    position: number;
    target: HTMLButtonElement;
    ownerDocument: Document;
    removeDocumentListeners: () => void;
    removeCursorLockClass: () => void;
};

export type KnobControlProps = Readonly<{
    control: Knob;
    position: number;
    disabled?: boolean;
    label?: string;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
    onPositionChange?: ((position: number) => void) | undefined;
}>;

export function KnobControl({
    control,
    position,
    disabled = false,
    label = control.name,
    className,
    classNames,
    onPositionChange,
}: KnobControlProps) {
    const drag = useRef<KnobDragState | undefined>(undefined);
    const [localPosition, setLocalPosition] = useState<number | undefined>(undefined);
    const [isDragging, setIsDragging] = useState(false);
    const normalizedPosition = snapControlPosition({ kind: 'knob', control }, position);
    const previousNormalizedPosition = useRef(normalizedPosition);
    const displayPosition = localPosition ?? normalizedPosition;
    const rotation = KNOB_START_DEGREES + displayPosition * KNOB_SWEEP_DEGREES;
    const progress = displayPosition * KNOB_SWEEP_DEGREES;
    const readout = formatControlValue({ kind: 'knob', control }, { kind: 'knob', position: displayPosition });

    useEffect(() => {
        if (previousNormalizedPosition.current === normalizedPosition) {
            return;
        }
        previousNormalizedPosition.current = normalizedPosition;
        if (drag.current === undefined) {
            setLocalPosition(undefined);
        }
    }, [normalizedPosition]);

    function snapPosition(nextPosition: number): number | undefined {
        if (disabled) {
            return undefined;
        }
        return snapControlPosition({ kind: 'knob', control }, nextPosition);
    }

    function setPosition(nextPosition: number): void {
        const snapped = snapPosition(nextPosition);
        if (snapped === undefined) {
            return;
        }
        setLocalPosition(snapped);
        onPositionChange?.(snapped);
    }

    function updateDragPosition(pointerId: number | undefined, clientX: number, movementX: number | undefined): void {
        const currentDrag = drag.current;
        if (currentDrag === undefined || (pointerId !== undefined && currentDrag.pointerId !== pointerId)) {
            return;
        }

        const hasRelativeMovement = movementX !== undefined && Number.isFinite(movementX);
        const nextPosition = hasRelativeMovement
            ? currentDrag.position + movementX / KNOB_DRAG_PIXELS_PER_RANGE
            : currentDrag.startPosition + (clientX - currentDrag.startX) / KNOB_DRAG_PIXELS_PER_RANGE;
        const snapped = snapPosition(nextPosition);
        if (snapped === undefined) {
            return;
        }
        if (snapped === currentDrag.position) {
            return;
        }
        currentDrag.position = snapped;
        setLocalPosition(snapped);
        onPositionChange?.(snapped);
    }

    function finishDrag(pointerId: number | undefined): void {
        const currentDrag = drag.current;
        if (currentDrag === undefined || (pointerId !== undefined && currentDrag.pointerId !== pointerId)) {
            return;
        }

        drag.current = undefined;
        setIsDragging(false);
        currentDrag.removeDocumentListeners();
        currentDrag.removeCursorLockClass();
        try {
            currentDrag.target.releasePointerCapture(currentDrag.pointerId);
        } catch {
            // Pointer capture may already be released by the browser.
        }
        try {
            currentDrag.ownerDocument.exitPointerLock?.();
        } catch {
            // Some test and embedded environments expose partial pointer-lock APIs.
        }
    }

    function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
        if (disabled) {
            return;
        }
        event.preventDefault?.();
        const target = event.currentTarget;
        const ownerDocument = target.ownerDocument;
        const removeDocumentListeners = addKnobDragDocumentListeners(ownerDocument, {
            move: (clientX, movementX, pointerId) => updateDragPosition(pointerId, clientX, movementX),
            end: (pointerId) => finishDrag(pointerId),
        });
        const removeCursorLockClass = addKnobDraggingDocumentClass(ownerDocument);
        drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startPosition: normalizedPosition,
            position: normalizedPosition,
            target,
            ownerDocument,
            removeDocumentListeners,
            removeCursorLockClass,
        };
        setLocalPosition(normalizedPosition);
        setIsDragging(true);
        try {
            target.setPointerCapture(event.pointerId);
        } catch {
            // Document-level listeners still keep the drag active when capture is unavailable.
        }
        requestKnobPointerLock(target);
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
        if (drag.current?.removeDocumentListeners !== undefined) {
            return;
        }
        updateDragPosition(event.pointerId, event.clientX, event.movementX);
    }

    function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
        finishDrag(event.pointerId);
    }

    function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
        const step = knobStepSize(control) ?? 0.01;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPosition(normalizedPosition + step);
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            setPosition(normalizedPosition - step);
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setPosition(0);
        }
        if (event.key === 'End') {
            event.preventDefault();
            setPosition(1);
        }
    }

    const knobStyle = {
        '--vdsp-control-ui-knob-rotation': `${rotation}deg`,
        '--vdsp-control-ui-knob-sweep': `${KNOB_SWEEP_DEGREES}deg`,
        '--vdsp-control-ui-knob-progress': `${progress}deg`,
    } as CSSProperties &
        Record<
            | '--vdsp-control-ui-knob-rotation'
            | '--vdsp-control-ui-knob-sweep'
            | '--vdsp-control-ui-knob-progress',
            string
        >;

    return (
        <ControlFrame label={label} readout={readout} disabled={disabled} className={className} classNames={classNames}>
            <button
                type="button"
                className={cx(
                    'vdsp-control-ui-control',
                    'vdsp-control-ui-knob',
                    isDragging && 'is-dragging',
                    classNames?.control,
                )}
                style={knobStyle}
                role="slider"
                aria-label={control.name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(displayPosition * 100)}
                disabled={disabled}
                data-vdsp-control-id={control.id}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onKeyDown={handleKeyDown}
            >
                <span className="vdsp-control-ui-knob__progress" aria-hidden="true">
                    <span className="vdsp-control-ui-knob__progress-fill" />
                </span>
                <span className="vdsp-control-ui-knob__body">
                    <span className="vdsp-control-ui-knob__indicator-line" />
                </span>
            </button>
        </ControlFrame>
    );
}

function addKnobDragDocumentListeners(
    ownerDocument: Document,
    handlers: {
        move: (clientX: number, movementX: number | undefined, pointerId: number | undefined) => void;
        end: (pointerId: number | undefined) => void;
    },
): () => void {
    function handlePointerMove(event: globalThis.PointerEvent): void {
        event.preventDefault();
        handlers.move(event.clientX, event.movementX, event.pointerId);
    }

    function handleMouseMove(event: MouseEvent): void {
        event.preventDefault();
        handlers.move(event.clientX, event.movementX, undefined);
    }

    function handlePointerEnd(event: globalThis.PointerEvent): void {
        handlers.end(event.pointerId);
    }

    function handleMouseEnd(): void {
        handlers.end(undefined);
    }

    ownerDocument.addEventListener('pointermove', handlePointerMove, { passive: false });
    ownerDocument.addEventListener('pointerup', handlePointerEnd);
    ownerDocument.addEventListener('pointercancel', handlePointerEnd);
    ownerDocument.addEventListener('mousemove', handleMouseMove, { passive: false });
    ownerDocument.addEventListener('mouseup', handleMouseEnd);

    return () => {
        ownerDocument.removeEventListener('pointermove', handlePointerMove);
        ownerDocument.removeEventListener('pointerup', handlePointerEnd);
        ownerDocument.removeEventListener('pointercancel', handlePointerEnd);
        ownerDocument.removeEventListener('mousemove', handleMouseMove);
        ownerDocument.removeEventListener('mouseup', handleMouseEnd);
    };
}

function addKnobDraggingDocumentClass(ownerDocument: Document): () => void {
    const className = 'vdsp-control-ui-is-knob-dragging';
    ownerDocument.documentElement.classList.add(className);
    return () => ownerDocument.documentElement.classList.remove(className);
}

function requestKnobPointerLock(target: HTMLButtonElement): void {
    const candidates = [target, target.ownerDocument.body, target.ownerDocument.documentElement];
    for (const candidate of candidates) {
        const requestPointerLock = candidate?.requestPointerLock;
        if (requestPointerLock === undefined) {
            continue;
        }
        try {
            requestPointerLock.call(candidate);
            return;
        } catch {
            // Try the next DOM target. Pointer capture still works without pointer lock.
        }
    }
}
