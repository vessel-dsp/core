import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
	site: "https://vessel-dsp.github.io/core/",
	base: "/core",
	srcDir: "./docs/src",
	publicDir: "./docs/public",
	outDir: "./gh-pages",
	integrations: [
		starlight({
			title: "VesselDSP Docs",
			description:
				"Headless circuit conversion and stompbox layout documentation.",
			editLink: {
				baseUrl: "https://github.com/vessel-dsp/core/edit/main/",
			},
			lastUpdated: true,
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/vessel-dsp/core",
				},
			],
			plugins: [
				starlightTypeDoc({
					entryPoints: [
						"packages/core/src/index.ts",
						"packages/stompbox/src/index.ts",
						"packages/control-ui/src/index.ts",
					],
					tsconfig: "tsconfig.docs.json",
					output: "reference/api",
					sidebar: {
						label: "API Reference",
						collapsed: true,
					},
					typeDoc: {
						name: "VesselDSP API",
						readme: "none",
						alwaysCreateEntryPointModule: true,
						entryPointStrategy: "resolve",
						excludePrivate: true,
						excludeProtected: true,
						hideGenerator: true,
					},
				}),
			],
			sidebar: [
				{
					label: "Start Here",
					items: [
						{ label: "Overview", link: "/" },
						{ label: "Getting Started", link: "/guides/getting-started/" },
					],
				},
				{
					label: "Formats",
					items: [{ label: "Supported Formats", link: "/formats/" }],
				},
				{
					label: "Examples",
					items: [
						{ label: "Pro Co Rat Schematic", link: "/examples/pro-co-rat/" },
					],
				},
				{
					label: "Guides",
					items: [
						{ label: "Stompbox Layouts", link: "/guides/stompbox/" },
						{ label: "Controls", link: "/guides/controls/" },
						{ label: "Control UI", link: "/guides/control-ui/" },
					],
				},
				typeDocSidebarGroup,
			],
		}),
	],
});
