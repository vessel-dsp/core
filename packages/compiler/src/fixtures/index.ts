// Synthetic circuits with hand-computed expectations: the compiler's and runtime's test
// inputs, and the known-answer controls the parity instruments render. Shipped as a
// subpath because an instrument's control must be a circuit whose answer is known
// independently of the instrument, and these are the only such circuits.
export * from "./circuits";
export * from "./expected";
export * from "./registry";
