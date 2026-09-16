/**
 * A number that knows what it is *per*.
 *
 * **Not a branded `number`, and the standard recipe fails here for a reason worth stating.** A
 * branded number is still a number, so TypeScript permits `>=` between two of them — which is
 * exactly the comparison this exists to reject. Tested before writing: the branded form blocks
 * `const x: PerBlock = 5000` and waves through `saving >= measured`, so it fails at the only case
 * it is for.
 *
 * The error it prevents is a class, not an incident. On 2026-09-11 a saving was registered per
 * BLOCK and measured per PACKET; pre-registration, the control set and rule 32 all passed it,
 * because **each was correct at the level it was stated**. 84% became 0.3%. The same shape cost
 * two more hours the same day: a bound wrong by 64x (per-sample read as per-render) and an
 * attribution reading 106.2% (per-drive against a shared window — a signal larger than its own
 * total). A `PerBlock` and a `PerPacket` as distinct types could not have been compared at all.
 *
 * **The cost, stated honestly.** An opaque type is more invasive than a brand: arithmetic needs
 * `.value`, and it is not erased — it allocates. Confine it to comparisons, thresholds and
 * recorded figures. Never put one in an inner loop.
 */
export type Per<T extends string> = {
	readonly denomination: T;
	readonly value: number;
};

export type PerBlock = Per<"block">;
export type PerPacket = Per<"packet">;
export type PerSample = Per<"sample">;
export type PerRender = Per<"render">;
export type PerDrive = Per<"drive">;
export type SharedWindow = Per<"shared-window">;

export const perBlock = (value: number): PerBlock => ({ denomination: "block", value });
export const perPacket = (value: number): PerPacket => ({ denomination: "packet", value });
export const perSample = (value: number): PerSample => ({ denomination: "sample", value });
export const perRender = (value: number): PerRender => ({ denomination: "render", value });
export const perDrive = (value: number): PerDrive => ({ denomination: "drive", value });
export const sharedWindow = (value: number): SharedWindow => ({
	denomination: "shared-window",
	value,
});

/**
 * Comparison, legal only WITHIN one denomination.
 *
 * **`NoInfer` on the second operand is load-bearing.** Without it `T` widens to the union of both
 * arguments and the guard accepts precisely what it exists to reject — the second of the two
 * designs tried here, and it passed its own negative control before `NoInfer` was added.
 */
export const atLeast = <T extends string>(a: Per<T>, b: Per<NoInfer<T>>): boolean =>
	a.value >= b.value;

/** Deliberately requires the share: the error was this conversion performed implicitly. */
export const blockToPacket = (v: PerBlock, shareOfPacket: number): PerPacket => ({
	denomination: "packet",
	value: v.value * shareOfPacket,
});

export const sampleToRender = (v: PerSample, samples: number): PerRender => ({
	denomination: "render",
	value: v.value * samples,
});
