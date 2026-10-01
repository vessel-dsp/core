# NAM engine — third-party notices

`nam-engine.js` and `nam-engine.wasm` are **build outputs**, not sources. They are produced
by `scripts/build-nam-engine.sh`, which pins the exact upstream revisions below. Rebuild rather than
hand-edit.

| component | revision | licence |
|---|---|---|
| [tone-3000/neural-amp-modeler-wasm](https://github.com/tone-3000/neural-amp-modeler-wasm) (the `nam-engine` target) | `a6c895049771bacc40c74dfa19369c2ebf75cdb1` | MIT, © 2026 TONE3000 |
| [sdatkinson/NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) v0.5.4 | `1f42f88535884450104b8711d7595019afa0495b` | MIT, © 2023 Steven Atkinson |
| [Eigen](https://eigen.tuxfamily.org) (header-only, statically linked) | `bc3b39870ecb690a623a3f49149a358b95c5781d` | MPL2 primarily; see the project's `COPYING.README` |
| [nlohmann/json](https://github.com/nlohmann/json) (header-only) | vendored by the core above | MIT |

## Vendored artifact checksums

| file | sha256 |
|---|---|
| `nam-engine.wasm` | `f0f84866bcf54b175d93f5627a8c48581e6a2bbcd052ca883b57167f823d1d86` |
| `nam-engine.js` | `1c4463155b847770dd265c35daa6fe63c70978994d3624ebd71279f29c774e79` |

MIT requires its copyright and permission notice to travel with copies and substantial portions of
the software, which is why this file sits beside the artifacts and is listed in the package's
`files`. Eigen is MPL2, which is file-level weak copyleft: statically linking it imposes no
condition on the combined work, and only modifications to Eigen's own files would need publishing.
We modify none. Eigen also ships a handful of LGPL-licensed files that `EIGEN_MPL2_ONLY` excludes;
the upstream build does not set it, and the `nam-engine` target does not reference those components.

## Model files are not bundled

The engine is vendored; `.nam` model files are not. Models are third-party captures whose
licences are their authors' -- it is the user's responsibility to supply models they are licensed
to use. The package ships no model and the node takes the model's JSON text from the caller.
