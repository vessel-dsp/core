---
name: astro-starlight
description: Work on Astro Starlight documentation sites and integrations, including astro.config.mjs, @astrojs/starlight, Starlight sidebars/content, MDX and .astro docs components, starlight-typedoc, static docs builds, and starlight-llms-txt llms.txt generation. Use this whenever the user mentions Astro, Starlight, @astrojs/starlight, docs navigation, docs components, docs:dev/build:pages, llms.txt docs output, or adding/configuring/troubleshooting Starlight plugins.
---

# Astro Starlight

Use this skill for agent work on Astro Starlight documentation sites. In this
repo, Starlight is the static documentation layer for the headless VesselDSP
packages, so keep docs work separate from package runtime behavior.

## Start by Orienting

1. Inspect the local Starlight setup before editing:
   - `package.json` for scripts, package manager, and installed integrations.
   - `astro.config.mjs` for `site`, `base`, `srcDir`, `publicDir`, `outDir`,
     Starlight options, plugins, and sidebar shape.
   - `docs/src/content.config.ts` for content collections.
   - Relevant files under `docs/src/content/docs/`, `docs/src/components/`,
     and `docs/public/`.
2. Use `rg` for search and Bun commands for package/script work unless the user
   explicitly asks for another package manager.
3. Preserve existing docs architecture. Prefer local `.astro` docs components
   and static assets over adding a React UI layer or reusable app package.

## Repo-Specific Defaults

- Docs source lives under `docs/src`.
- Static docs assets live under `docs/public`.
- The Pages build writes to `gh-pages`.
- The root scripts include:
  - `bun run docs:dev` for local docs development.
  - `bun run docs:preview` for previewing a built site.
  - `bun run build:pages` for the Astro/Starlight build.
- For docs and Pages changes, prefer the smallest verification that covers the
  edit. Common checks are `bun test tests/pages tests/package.test.ts` and
  `bun run build:pages`.

## Editing Starlight Config

- Top-level Astro integrations go in `defineConfig({ integrations: [...] })`.
- Starlight plugins go inside `starlight({ plugins: [...] })`, not in Astro's
  top-level integrations array.
- Keep existing plugin order unless the new plugin depends on another plugin's
  generated routes/content.
- Keep `site` accurate for absolute URLs. If `base` is set, remember generated
  preview routes may be under that base path.
- Keep sidebars explicit when the repo already uses explicit navigation. Add
  entries near related content instead of rearranging unrelated groups.
- Do not hand-edit generated TypeDoc output. Update source docs or TypeDoc /
  `starlight-typedoc` configuration instead.

## Writing MDX and Astro Docs Components

- Use MDX for documentation pages and `.astro` for docs-only components.
- Keep components server-renderable by default. Add client-side JavaScript only
  when the docs interaction requires it, and keep it scoped to `docs/public` or
  the component that owns it.
- Use Starlight-native primitives and Markdown before custom layout.
- Keep component styles scoped and modest. Docs pages should remain readable in
  Starlight's default layout and responsive at narrow widths.
- When adding public files referenced by docs, use paths that work with the
  configured `base`.

## starlight-llms-txt

Use `starlight-llms-txt` when the user wants LLM-readable context files for a
Starlight docs site. The plugin generates:

- `llms.txt` as the entrypoint.
- `llms-full.txt` as complete docs context.
- `llms-small.txt` as a smaller, filtered context file.

Install with Bun in this repo:

```sh
bun add -d starlight-llms-txt
```

Configure it in `astro.config.mjs` inside the Starlight `plugins` array:

```js
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
	site: "https://example.com/",
	integrations: [
		starlight({
			title: "My Docs",
			plugins: [
				starlightLlmsTxt({
					projectName: "My Project",
				}),
			],
		}),
	],
});
```

Useful options:

- `projectName`: custom project/software name. Defaults to Starlight `title`.
- `description`: blockquote summary in `llms.txt`. Defaults to Starlight
  `description`.
- `details`: extra Markdown after the description in `llms.txt`; do not use
  headings here.
- `optionalLinks`: secondary links that models can skip when context is tight.
- `customSets`: additional generated docs subsets. Each set needs a `label` and
  `paths` using page slugs or micromatch glob patterns.
- `promote`: page slugs/globs sorted to the top of full and small outputs.
  Defaults to `["index*"]`.
- `demote`: page slugs/globs sorted to the bottom. Demotion wins if a page
  matches both `promote` and `demote`.
- `exclude`: page slugs/globs excluded from `llms-small.txt`.
- `rawContent`: use raw Markdown without render processing. Enable this when
  docs content includes framework components such as React, Vue, or Svelte, or
  when processing cost is a concern for a large docs site.
- `customSelectors`: CSS-style selectors removed from rendered HTML before
  Markdown conversion. Prefer the object form:
  - `all`: applies to every generated output.
  - `full`: applies to `llms-full.txt` and custom sets.
  - `small`: applies to `llms-small.txt`.
- `minify`: controls what is removed from `llms-small.txt`, including
  `note`, `tip`, `caution`, `danger`, `details`, `whitespace`, and
  `collapseCodeBlocks`.
- `pageSeparator`: string used between concatenated page entries.

Prefer top-level `customSelectors` over deprecated `minify.customSelectors`.
The deprecated field still applies only to `llms-small.txt`.

Good default shape for this repo:

```js
starlightLlmsTxt({
	projectName: "VesselDSP",
	description:
		"Headless TypeScript packages for audio-circuit document conversion and stompbox layout generation.",
	customSets: [
		{
			label: "API reference",
			description: "public API reference for VesselDSP packages",
			paths: ["reference/api/**"],
		},
	],
	promote: ["index*", "guides/getting-started*"],
	exclude: ["reference/api/**"],
})
```

Adjust the defaults to the user's requested information architecture. Do not
exclude essential docs from `llms-small.txt` just to make the file shorter.

## Verification

- After config changes, run `bun run build:pages`.
- For docs behavior covered by tests, run `bun test tests/pages`.
- For package contract or export docs changes, add `tests/package.test.ts` when
  relevant.
- For `starlight-llms-txt`, inspect generated files in the build output:
  `gh-pages/llms.txt`, `gh-pages/llms-full.txt`, and `gh-pages/llms-small.txt`.
- If running the dev server, use `bun run docs:dev` and check the generated
  route in the browser. With a configured `base`, check the base-prefixed route
  as well as the root route if one 404s.

## Final Response

Summarize:

- Which docs/config files changed.
- Which Starlight plugins or content routes were added or adjusted.
- Which verification commands ran and whether any generated `llms*.txt` files
  were inspected.
