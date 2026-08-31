/**
 * Version of the observable `.vdsp` parse contract, independent of the
 * `circuit-interchange/v2` and `circuit-interchange/v3` schema identifiers.
 *
 * A schema id describes the document shape a file is allowed to have. This
 * describes what core guarantees about the data a consumer recovers from that
 * file, so downstream code can gate adoption on behaviour instead of on a
 * package version range.
 *
 * Bump it when a consumer must change to stay correct. Leave it alone for
 * additive fields, new diagnostics, and fixes that only narrow what parses.
 *
 * 1 - inline terminal `node` keys and the `nodes` ledger are merged into one
 *     connectivity interpretation. Agreement between them is redundant;
 *     disagreement is refused rather than silently resolved in favour of
 *     either declaration style.
 */
export const INTERCHANGE_CONTRACT_VERSION = 1 as const;
