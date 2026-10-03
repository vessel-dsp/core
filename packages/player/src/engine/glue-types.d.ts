// Untyped build-output imports. The Emscripten glue files ship without
// type declarations (and only exist after their package's build runs), so
// static imports of them resolve to `any` rather than erroring.
declare module "*.cjs";
