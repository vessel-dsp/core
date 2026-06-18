import { describe, expect, test } from 'bun:test';
import {
    VERSION,
    convertCircuitDocumentFileWithReport,
    movePanelElement,
    parseCircuitJsonDocument,
    serializeCircuitJsonDocument,
    validateCircuitJsonDocument,
} from '@vessel-dsp/core';
import {
    createStompboxAppearancePatch,
    createStompboxDrillLayoutFromVdsp,
    createStompboxDrillTemplateFromVdsp,
    createStompboxDrillTemplateSvgFromVdsp,
    createStompboxPreviewGlbFromVdsp,
    createStompboxPreviewFromVdsp,
    createStompboxPreviewSvgViewsFromVdsp,
    resolveStompboxAppearance,
} from '@vessel-dsp/stompbox';
import { fileURLToPath } from 'node:url';
import { rewriteRelativeEsmSpecifiers } from '../scripts/fix-dist-imports';

type JsonRecord = Readonly<Record<string, unknown>>;

const removedScopedPackageNames = [
    `@vessel-dsp/${'react' + '-component'}`,
    `@vessel-dsp/${'sim' + 'ulation'}`,
] as const;
const removedWorkspacePackageDirs = [
    `packages/${'react' + '-component'}`,
    `packages/${'sim' + 'ulation'}`,
] as const;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<JsonRecord> {
    const value = await Bun.file(new URL(path, import.meta.url)).json();
    if (!isRecord(value)) {
        throw new Error(`${path} did not parse to an object`);
    }
    return value;
}

async function readRootPackageJson(): Promise<JsonRecord> {
    return readJson('../package.json');
}

async function readPackageJson(packageDir: string): Promise<JsonRecord> {
    return readJson(`../packages/${packageDir}/package.json`);
}

async function readPackageTsconfig(packageDir: string): Promise<JsonRecord> {
    return readJson(`../packages/${packageDir}/tsconfig.json`);
}

async function readPublishWorkflow(): Promise<string> {
    return Bun.file(new URL('../.github/workflows/publish.yml', import.meta.url)).text();
}

async function readDeployWorkflow(): Promise<string> {
    return Bun.file(new URL('../.github/workflows/deploy.yml', import.meta.url)).text();
}

async function readReadme(): Promise<string> {
    return Bun.file(new URL('../README.md', import.meta.url)).text();
}

async function readChangelog(): Promise<string> {
    return Bun.file(new URL('../CHANGELOG.md', import.meta.url)).text();
}

async function readCoreDistIndexJs(): Promise<string> {
    return Bun.file(new URL('../packages/core/dist/index.js', import.meta.url)).text();
}

async function readCoreDistIndexDts(): Promise<string> {
    return Bun.file(new URL('../packages/core/dist/index.d.ts', import.meta.url)).text();
}

async function readStompboxDistIndexJs(): Promise<string> {
    return Bun.file(new URL('../packages/stompbox/dist/index.js', import.meta.url)).text();
}

async function readStompboxDistIndexDts(): Promise<string> {
    return Bun.file(new URL('../packages/stompbox/dist/index.d.ts', import.meta.url)).text();
}

function shouldScanRepositoryPath(path: string): boolean {
    return !(
        path.startsWith('.git/') ||
        path.startsWith('node_modules/') ||
        path.startsWith('packages/core/dist/') ||
        path.startsWith('packages/stompbox/dist/') ||
        path.startsWith('gh-pages/') ||
        path === 'bun.lock'
    );
}

async function readTextIfScannable(path: string): Promise<string | undefined> {
    const file = Bun.file(new URL(`../${path}`, import.meta.url));
    if (!(await file.exists())) {
        return undefined;
    }

    const contents = await file.arrayBuffer();
    const bytes = new Uint8Array(contents);
    if (bytes.includes(0)) {
        return undefined;
    }

    return new TextDecoder().decode(bytes);
}

function runtimeDependencies(pkg: JsonRecord): JsonRecord {
    return isRecord(pkg.dependencies) ? pkg.dependencies : {};
}

function devDependencies(pkg: JsonRecord): JsonRecord {
    return isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
}

function expectExport(
    exportsField: unknown,
    exportName: string,
    expected: { readonly importPath: string; readonly typesPath: string },
): void {
    expect(isRecord(exportsField)).toBe(true);
    if (!isRecord(exportsField)) {
        return;
    }

    const target = exportsField[exportName];
    expect(isRecord(target)).toBe(true);
    if (!isRecord(target)) {
        return;
    }

    expect(target.import).toBe(expected.importPath);
    expect(target.types).toBe(expected.typesPath);
}

function expectNoReactRuntimeDependency(pkg: JsonRecord): void {
    const deps = runtimeDependencies(pkg);
    expect(deps.react).toBeUndefined();
    expect(deps['react-dom']).toBeUndefined();
}

function collectExportTargets(value: unknown): readonly string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (!isRecord(value)) {
        return [];
    }
    return Object.values(value).flatMap((target) => collectExportTargets(target));
}

describe('workspace package contract', () => {
    test('root manifest is a private Bun workspace for headless packages', async () => {
        const pkg = await readRootPackageJson();
        const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};

        expect(pkg.name).toBe('@vessel-dsp/workspace');
        expect(pkg.private).toBe(true);
        expect(pkg.packageManager).toBe('bun@1.2.2');
        expect(pkg.publishConfig).toBeUndefined();
        expect(pkg.exports).toBeUndefined();
        expect(pkg.files).toBeUndefined();
        expect(pkg.workspaces).toEqual(['packages/*']);
        expect(scripts.build).toContain('packages/core');
        expect(scripts.build).toContain('packages/stompbox');
        for (const packageDir of removedWorkspacePackageDirs) {
            expect(scripts.build).not.toContain(packageDir);
        }
        expect(scripts['build:pages']).toBe('astro build');
        expect(scripts['docs:dev']).toBe('astro dev');
        expect(scripts['docs:preview']).toBe('astro preview');
        expect(scripts['build:playground']).toBeUndefined();
        expect(scripts.dev).toBeUndefined();
        expect(scripts.preview).toBeUndefined();
        expect(scripts['pack:dry-run']).toContain('packages/core');
        expect(scripts['pack:dry-run']).toContain('packages/stompbox');
        for (const packageDir of removedWorkspacePackageDirs) {
            expect(scripts['pack:dry-run']).not.toContain(packageDir);
        }
    });

    test('core package publishes the headless Circuit JSON conversion API', async () => {
        const pkg = await readPackageJson('core');
        const deps = runtimeDependencies(pkg);

        expect(pkg.name).toBe('@vessel-dsp/core');
        expect(pkg.version).toBe(VERSION);
        expect(pkg.private).not.toBe(true);
        expect(pkg.type).toBe('module');
        expect(pkg.sideEffects).toBe(false);
        expect(pkg.main).toBe('./dist/index.js');
        expect(pkg.module).toBe('./dist/index.js');
        expect(pkg.types).toBe('./dist/index.d.ts');
        expectExport(pkg.exports, '.', {
            importPath: './dist/index.js',
            typesPath: './dist/index.d.ts',
        });
        expect(deps['circuit-json']).toBeDefined();
        expect(deps.zod).toBeDefined();
        expectNoReactRuntimeDependency(pkg);
        expect(typeof convertCircuitDocumentFileWithReport).toBe('function');
        expect(typeof movePanelElement).toBe('function');
    });

    test('stompbox package publishes headless drill layout and preview manifest APIs', async () => {
        const pkg = await readPackageJson('stompbox');
        const deps = runtimeDependencies(pkg);

        expect(pkg.name).toBe('@vessel-dsp/stompbox');
        expect(pkg.version).toBe(VERSION);
        expect(pkg.private).not.toBe(true);
        expect(pkg.type).toBe('module');
        expect(pkg.sideEffects).toBe(false);
        expect(pkg.main).toBe('./dist/index.js');
        expect(pkg.module).toBe('./dist/index.js');
        expect(pkg.types).toBe('./dist/index.d.ts');
        expectExport(pkg.exports, '.', {
            importPath: './dist/index.js',
            typesPath: './dist/index.d.ts',
        });
        expect(deps['@vessel-dsp/core']).toBe(VERSION);
        expectNoReactRuntimeDependency(pkg);
        expect(typeof createStompboxDrillLayoutFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewFromVdsp).toBe('function');
        expect(typeof createStompboxDrillTemplateFromVdsp).toBe('function');
        expect(typeof createStompboxDrillTemplateSvgFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewGlbFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewSvgViewsFromVdsp).toBe('function');
        expect(typeof createStompboxAppearancePatch).toBe('function');
        expect(typeof resolveStompboxAppearance).toBe('function');
    });

    test('removed React and simulation packages are not workspace deliverables', async () => {
        expect(await Bun.file(new URL(`../packages/${'react' + '-component'}/package.json`, import.meta.url)).exists()).toBe(false);
        expect(await Bun.file(new URL(`../packages/${'sim' + 'ulation'}/package.json`, import.meta.url)).exists()).toBe(false);
    });

    test('removed scoped package names are absent from repository files', async () => {
        const matches: string[] = [];
        const glob = new Bun.Glob('**/*');
        const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

        for await (const path of glob.scan({ cwd: repositoryRoot })) {
            if (!shouldScanRepositoryPath(path)) {
                continue;
            }

            const text = await readTextIfScannable(path);
            if (text === undefined) {
                continue;
            }

            for (const packageName of removedScopedPackageNames) {
                if (text.includes(packageName)) {
                    matches.push(`${path}: ${packageName}`);
                }
            }
            for (const packageDir of removedWorkspacePackageDirs) {
                if (text.includes(packageDir)) {
                    matches.push(`${path}: ${packageDir}`);
                }
            }
        }

        expect(matches).toEqual([]);
    });

    test('headless package tsconfigs stay DOM-free', async () => {
        const tsconfig = await readPackageTsconfig('core');
        const compilerOptions = isRecord(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
        const stompboxTsconfig = await readPackageTsconfig('stompbox');
        const stompboxCompilerOptions = isRecord(stompboxTsconfig.compilerOptions)
            ? stompboxTsconfig.compilerOptions
            : {};
        expect(compilerOptions.lib).toEqual(['ES2022']);
        expect(stompboxCompilerOptions.lib).toEqual(['ES2022']);
    });

    test('Circuit JSON schema tooling is a core runtime dependency, not root-only test plumbing', async () => {
        const root = await readRootPackageJson();
        const rootDevDeps = devDependencies(root);
        const core = await readPackageJson('core');
        const deps = runtimeDependencies(core);

        expect(rootDevDeps['circuit-json']).toBeUndefined();
        expect(deps['circuit-json']).toBeDefined();
        expect(deps.zod).toBeDefined();
        expect(deps['@tscircuit/runframe']).toBeUndefined();
    });

    test('root manifest has no playground UI dependencies', async () => {
        const root = await readRootPackageJson();
        const rootDevDeps = devDependencies(root);

        expect(rootDevDeps.react).toBeUndefined();
        expect(rootDevDeps['react-dom']).toBeUndefined();
        expect(rootDevDeps.vite).toBeUndefined();
        expect(rootDevDeps['@vitejs/plugin-react']).toBeUndefined();
        expect(rootDevDeps['@tscircuit/runframe']).toBeUndefined();
        expect(rootDevDeps['@tscircuit/schematic-viewer']).toBeUndefined();
        expect(rootDevDeps['@tailwindcss/vite']).toBeUndefined();
        expect(rootDevDeps.tailwindcss).toBeUndefined();
        expect(rootDevDeps['lucide-react']).toBeUndefined();
        expect(rootDevDeps['radix-ui']).toBeUndefined();
    });

    test('declares the MIT license and includes docs in publishable packages', async () => {
        for (const packageDir of ['core', 'stompbox']) {
            const pkg = await readPackageJson(packageDir);
            expect(pkg.license).toBe('MIT');
            expect(Array.isArray(pkg.files)).toBe(true);
            expect(pkg.files).toContain('LICENSE.md');
            expect(pkg.files).toContain('README.md');
        }
    });

    test('stompbox publishes bundled CAD assets for local preview assembly', async () => {
        const pkg = await readPackageJson('stompbox');
        const files = Array.isArray(pkg.files) ? pkg.files : [];

        expect(files).toContain('assets');
        expect(await Bun.file(new URL('../packages/stompbox/assets/cad/parts/box-1590b/.tayda-a6619.step.glb', import.meta.url)).exists()).toBe(true);
        expect(await Bun.file(new URL('../packages/stompbox/assets/cad/parts/box-1590b/tayda-a6619.step', import.meta.url)).exists()).toBe(true);
        expect(await Bun.file(new URL('../packages/stompbox/assets/cad/parts/dc-socket-dc099/.dc099.step.glb', import.meta.url)).exists()).toBe(true);
        expect(await Bun.file(new URL('../packages/stompbox/assets/cad/parts/dc-socket-dc099/dc099.step', import.meta.url)).exists()).toBe(true);
    });

    test('publishable packages publish built dist artifacts without source fallback', async () => {
        for (const packageDir of ['core', 'stompbox']) {
            const pkg = await readPackageJson(packageDir);
            const files = Array.isArray(pkg.files) ? pkg.files : [];
            const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
            const entryTargets = [
                pkg.main,
                pkg.module,
                pkg.types,
                ...collectExportTargets(pkg.exports),
            ].filter((target): target is string => typeof target === 'string');

            expect(files).toContain('dist');
            expect(files).not.toContain('src');
            expect(scripts.prepack).toContain('bun run build');

            for (const target of entryTargets) {
                if (target === './package.json') {
                    continue;
                }
                expect(target).toStartWith('./dist/');
            }
        }
    });

    test('publishes package homepage and GitHub repository metadata for npm package pages', async () => {
        const packages = [
            await readPackageJson('core'),
            await readPackageJson('stompbox'),
        ];

        for (const pkg of packages) {
            expect(pkg.homepage).toBe('https://vessel-dsp.github.io/core/');

            expect(isRecord(pkg.repository)).toBe(true);
            if (isRecord(pkg.repository)) {
                expect(pkg.repository.type).toBe('git');
                expect(pkg.repository.url).toBe('git+https://github.com/vessel-dsp/core.git');
            }

            expect(isRecord(pkg.bugs)).toBe(true);
            if (isRecord(pkg.bugs)) {
                expect(pkg.bugs.url).toBe('https://github.com/vessel-dsp/core/issues');
            }
        }
    });
});

describe('published import surface', () => {
    test('core exposes Circuit JSON conversion helpers', () => {
        expect(typeof serializeCircuitJsonDocument).toBe('function');
        expect(typeof parseCircuitJsonDocument).toBe('function');
        expect(typeof validateCircuitJsonDocument).toBe('function');
    });

    test('stompbox exposes drill layout, drill template, and preview helpers', () => {
        expect(typeof createStompboxDrillLayoutFromVdsp).toBe('function');
        expect(typeof createStompboxDrillTemplateFromVdsp).toBe('function');
        expect(typeof createStompboxDrillTemplateSvgFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewGlbFromVdsp).toBe('function');
        expect(typeof createStompboxPreviewSvgViewsFromVdsp).toBe('function');
        expect(typeof createStompboxAppearancePatch).toBe('function');
        expect(typeof resolveStompboxAppearance).toBe('function');
    });
});

describe('npm publish workflow', () => {
    test('publishes core and stompbox in dependency order', async () => {
        const workflow = await readPublishWorkflow();

        expect(workflow).toContain('name: Publish to npm');
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain('push:');
        expect(workflow).toContain('tags:');
        expect(workflow).toContain("- 'v*'");
        expect(workflow).not.toContain('release:');
        expect(workflow).toContain('id-token: write');
        expect(workflow).toContain('oven-sh/setup-bun@v2');
        expect(workflow).toContain('actions/setup-node@v4');
        expect(workflow).toContain('registry-url: https://registry.npmjs.org');
        expect(workflow).toContain("scope: '@vessel-dsp'");
        expect(workflow).toContain('bun install --frozen-lockfile');
        expect(workflow).toContain('bun run pack:dry-run');
        expect(workflow).toContain('npm publish --workspace @vessel-dsp/core --access public --provenance');
        expect(workflow).toContain('npm publish --workspace @vessel-dsp/stompbox --access public --provenance');
        expect(workflow.indexOf('@vessel-dsp/core')).toBeLessThan(workflow.indexOf('@vessel-dsp/stompbox'));
        for (const packageName of removedScopedPackageNames) {
            expect(workflow).not.toContain(packageName);
        }
    });
});

describe('GitHub Pages workflow', () => {
    test('deploys the Starlight documentation site instead of a playground app', async () => {
        const workflow = await readDeployWorkflow();

        expect(workflow).toContain('name: Deploy documentation to GitHub Pages');
        expect(workflow).toContain('bun run build:pages');
        expect(workflow).toContain('path: gh-pages');
        expect(workflow).not.toContain('build:playground');
        expect(workflow).not.toContain('vite');
        expect(workflow).not.toContain('playground');
    });
});

describe('README package metadata', () => {
    test('shows npm badge for the canonical package', async () => {
        const readme = await readReadme();

        expect(readme).toContain('[![core npm version](https://img.shields.io/npm/v/%40vessel-dsp%2Fcore.svg)]');
        expect(readme).toContain('(https://www.npmjs.com/package/@vessel-dsp/core)');
        for (const packageName of removedScopedPackageNames) {
            expect(readme).not.toContain(packageName);
        }
    });
});

describe('release metadata', () => {
    test('pins the current package release and changelog entry', async () => {
        const core = await readPackageJson('core');
        const stompbox = await readPackageJson('stompbox');
        const changelog = await readChangelog();
        const distIndex = await readCoreDistIndexJs();
        const distTypes = await readCoreDistIndexDts();
        const stompboxDistIndex = await readStompboxDistIndexJs();
        const stompboxDistTypes = await readStompboxDistIndexDts();

        expect(core.version).toBe('0.6.3');
        expect(stompbox.version).toBe('0.6.3');
        expect(VERSION).toBe('0.6.3');
        expect(distIndex).toContain("export const VERSION = '0.6.3';");
        expect(distTypes).toContain('export declare const VERSION = "0.6.3";');
        expect(stompboxDistIndex).toContain('createStompboxDrillLayoutFromVdsp');
        expect(stompboxDistIndex).toContain('createStompboxDrillTemplateSvgFromVdsp');
        expect(stompboxDistIndex).toContain('createStompboxPreviewGlbFromVdsp');
        expect(stompboxDistIndex).toContain('createStompboxPreviewSvgViewsFromVdsp');
        expect(stompboxDistIndex).toContain('createStompboxAppearancePatch');
        expect(stompboxDistIndex).toContain('resolveStompboxAppearance');
        expect(stompboxDistTypes).toContain('createStompboxDrillLayoutFromVdsp');
        expect(stompboxDistTypes).toContain('createStompboxDrillTemplateSvgFromVdsp');
        expect(stompboxDistTypes).toContain('createStompboxPreviewGlbFromVdsp');
        expect(stompboxDistTypes).toContain('createStompboxPreviewSvgViewsFromVdsp');
        expect(stompboxDistTypes).toContain('createStompboxAppearancePatch');
        expect(stompboxDistTypes).toContain('resolveStompboxAppearance');
        expect(changelog).toStartWith('# Changelog\n\n## 0.6.3\n\n');
    });
});

describe('dist import rewriting', () => {
    test('adds .js extensions to relative ESM specifiers that point at emitted files', () => {
        const rewritten = rewriteRelativeEsmSpecifiers(
            [
                "export * from '../../index';",
                "import { parseCircuitDocument } from './formats/document';",
                "import './side-effect';",
                "import external from 'circuit-json';",
                "import already from './ready.js';",
            ].join('\n'),
            new URL('file:///Users/example/project/packages/core/dist/formats/circuit-json/index.js'),
            new Set([
                '/Users/example/project/packages/core/dist/index.js',
                '/Users/example/project/packages/core/dist/formats/circuit-json/formats/document.js',
                '/Users/example/project/packages/core/dist/formats/circuit-json/side-effect.js',
            ]),
        );

        expect(rewritten).toContain("export * from '../../index.js';");
        expect(rewritten).toContain("from './formats/document.js';");
        expect(rewritten).toContain("import './side-effect.js';");
        expect(rewritten).toContain("from 'circuit-json';");
        expect(rewritten).toContain("from './ready.js';");
    });
});
