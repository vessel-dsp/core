# What is in main for this spike

Only the report (`../2026-10-10-pole-order2.md`), this harness and its logs. **The engine change is not in main and was deliberately not merged**: the report's outcome is FAILED, NOT FOR MERGE. The trapezoidal pole broke two canaries that converge on main (`boss-mt-2` stalls at os1 and os4, `boss-ch-1` at x1), and the backward-Euler pole error it removes is small beside the hardware residual.

The report refers to an uncommitted diff "left in place for review". That diff was three source files (`packages/runtime/src/reference-runtime.ts`, `packages/runtime/src/cpp/Engine.cpp`, `packages/runtime/src/cpp/include/v2/Engine.h`) and three test files, applied to core `49cc15c`. Its only copy is `~/pole-order2-trapezoid.patch` on the dev box, saved 2026-10-10 together with the docs. The worktree it came from has been removed. If the idea is revisited, the report names the open door: TR-BDF2 or SDIRK at about twice the Newton cost.
