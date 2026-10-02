/**
 * Addressable power-supply stamps for {@link ReferenceRuntime.setSupply}.
 *
 * A supply is a `dc-source` stamp: the solver row
 * `V(positive) - V(negative) - sourceOhms * i = volts`. This module names the
 * stamps so a host can retarget them at run time; it performs no audio-domain
 * processing and owns no envelope, waveshaper, or signal-chain node.
 */

/**
 * Names one `dc-source` stamp: the block's position in `program.blocks` and
 * the stamp's own `sourceIndex` within that block.
 */
export type SupplyAddress = {
	readonly blockIndex: number;
	readonly sourceIndex: number;
};

/**
 * One addressable `dc-source` stamp and the values the solver reads from it.
 *
 * `positive`/`negative` are the stamp's own terminal rows, exactly as stored
 * on the stamp; `nodeIds[positive]` is the authored net label for reporting.
 */
export type SupplyInfo = {
	readonly address: SupplyAddress;
	readonly positive: number;
	readonly negative: number;
	readonly volts: number;
	readonly sourceOhms: number;
};
