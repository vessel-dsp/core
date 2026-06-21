export function cx(...values: readonly (string | false | null | undefined)[]): string | undefined {
    const className = values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
    return className.length > 0 ? className : undefined;
}

export function clampNumber(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
        return min;
    }
    if (value === Number.POSITIVE_INFINITY) {
        return max;
    }
    if (value === Number.NEGATIVE_INFINITY) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

export function formatNumber(value: number): string {
    if (Number.isInteger(value)) {
        return String(value);
    }
    return String(Math.round(value * 1000) / 1000);
}
