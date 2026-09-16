import type { NodeId } from "./types";

/**
 * A **matrix row index**, branded so it cannot be spent as a `NodeId`.
 *
 * A block's rows and the source nodes they stand for are both small integers, and on
 * 2026-09-10/11 three of them were read as the wrong one. The silent substitution had a single
 * shape, repeated at eight sites:
 *
 * ```ts
 * const node = block.nodeIds[row] ?? row;   // <- the row index, printed as a node id
 * ```
 *
 * **That fallback fires exactly when something is wrong.** `nodeIds.length` is always the block's
 * unknown count, so an in-range row always resolves; the `??` branch is reachable only for an
 * out-of-range row — precisely the case where a reader most needs the truth and instead gets a
 * plausible-looking integer that names a different node.
 *
 * **This is the sharpest member of the integer-confusion family, and the reason to read the
 * branding as necessary rather than tidy.** The other three produced a value that was visibly
 * wrong. This one produces a value that **type-checks, reads correctly, and is a valid id in the
 * same block**: on a block whose `nodeIds` are `[0, 7, 9]`, row 7 printed `7` — a real node, a
 * different net, and nothing anywhere to indicate a substitution happened. A wrong answer that
 * survives every check a reader can apply is worse than one that crashes, and it is the failure
 * mode a type is actually for.
 *
 * `NodeId` itself is deliberately **not** branded. Requiring the brand across the corpus costs 389
 * sites, 142 of them in generated catalogs, to prevent an incident a careful reader could catch —
 * where `denomination.ts` prevents a class that got past four independent checks. Branding the row
 * alone closes the substitution at the boundary where it actually happened.
 */
export type BlockRow = number & { readonly __blockRow: unique symbol };

/** Explicit at the call site: this integer is a row, not a node. */
export const blockRow = (index: number): BlockRow => index as BlockRow;

/**
 * The row -> source-node lookup, **nullable on purpose**. There is no fallback to give, and the
 * `null` forces the caller to say what it means rather than substituting the row.
 */
export const nodeAt = (
	block: { readonly nodeIds: readonly NodeId[] },
	row: BlockRow,
): NodeId | null => block.nodeIds[row] ?? null;

/**
 * How an unresolved row is named in human-facing text: never as a bare integer, which is what
 * made the substitution invisible. `row 7` and `node 7` are different claims and now read
 * differently.
 */
export const describeRow = (
	block: { readonly nodeIds: readonly NodeId[] },
	row: BlockRow,
): string => {
	const node = nodeAt(block, row);
	return node === null ? `unmapped row ${row}` : String(node);
};
