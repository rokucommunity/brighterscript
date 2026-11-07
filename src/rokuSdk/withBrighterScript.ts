import * as path from 'path';
import * as os from 'os';
import * as fsExtra from 'fs-extra';
import { promises as fs } from 'fs';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ProgramBuilder } from '../ProgramBuilder';
import type { BsConfig } from '../BsConfig';
import type { BsDiagnostic } from '../interfaces';
import { util, standardizePath as s } from '../util';

/**
 * Integration with the Roku RSG SDK build tool (`rk`, https://gitlab.com/rokudev/rsg-sdk).
 *
 * `rk build` and `rk dev` copy the app's static folder (`pkg/` by default) into `<outDir>/bundle`, bundle the
 * TypeScript, then run a chain of esbuild `onEnd` steps: `assets` -> `solid` -> `hermes` (syncs bundle -> pkg-dir) -> `sideload`.
 * This module adds an esbuild plugin to that chain (through `roku-config.ts`'s `pipeline`) which compiles the
 * BrighterScript in the bundle in place, after rk has assembled it and before rk packages it.
 *
 * Only the small structural slice of the esbuild and `@roku-sdk/rsg-ts` types used here is declared below, so
 * brighterscript does not need to depend on either package.
 */

export interface RokuSdkMessage {
    id?: string;
    pluginName?: string;
    text: string;
    location?: {
        file: string;
        line: number;
        column: number;
        length?: number;
        lineText?: string;
    } | null;
    notes?: Array<{ text: string }>;
}

export interface RokuSdkBuildResult {
    errors: RokuSdkMessage[];
    warnings: RokuSdkMessage[];
}

export interface RokuSdkEsbuildPlugin {
    name: string;
    setup(build: { onEnd(callback: (result: RokuSdkBuildResult) => void | Promise<void>): void }): void | Promise<void>;
}

export type RokuSdkPluginPosition = 'first' | 'last' | { before: string } | { after: string };

/**
 * The fields of rk's merged build config (defaults -> roku-config.ts -> command-line flags) this integration reads
 */
export interface RokuSdkBuildConfig {
    rootDir?: string;
    outDir?: string;
    app?: {
        brsOnly?: boolean;
        staticAssetsDir?: string;
    };
}

export interface RokuSdkPipelineSection {
    preBuild?: (ctx: { config: any; isRebuild: boolean }) => void | Promise<void>;
    plugins?: Array<{ plugin: any; position: any }>;
    [key: string]: any;
}

/**
 * The shape of a `roku-config.ts` default export, as far as this integration is concerned
 */
export interface RokuSdkConfig extends RokuSdkBuildConfig {
    pipeline?: {
        build?: RokuSdkPipelineSection;
        startDev?: RokuSdkPipelineSection;
    };
    [key: string]: any;
}

export interface RokuSdkBrighterScriptOptions {
    /**
     * Path to a `bsconfig.json`. When omitted, the nearest `bsconfig.json` at or above the rk project root is used (if any).
     * `rootDir` and `outDir` from that file are ignored: rk decides where the source tree lives and where output goes.
     */
    project?: string;
    /**
     * Extra bsconfig options. These win over the values in `project`.
     */
    bsConfig?: BsConfig;
    /**
     * Report BrighterScript warnings as build errors, which stops `rk dev` from sideloading.
     * @default false
     */
    warningsAsErrors?: boolean;
}

/**
 * Directory names rk uses inside its `outDir`
 */
const BUNDLE_DIR_NAME = 'bundle';

/**
 * The output file types brighterscript produces that should replace what rk staged.
 * `manifest` is deliberately left out: rk has already written the final one (including `transformManifest` changes).
 */
const EMITTED_EXTENSIONS = ['.brs', '.xml', '.map'];

/**
 * Resolve the static assets folder the same way rk does: `pkg` for TypeScript apps, the project root for `brsOnly` apps
 */
export function getRokuSdkStaticAssetsDir(config: RokuSdkBuildConfig) {
    const defaultDir = config.app?.brsOnly ? '.' : 'pkg';
    return s`${path.resolve(config.rootDir ?? process.cwd(), config.app?.staticAssetsDir || defaultDir)}`;
}

/**
 * Resolve the folder rk stages the app in before it is synced to `pkg-dir` and sideloaded
 */
export function getRokuSdkBundleDir(config: RokuSdkBuildConfig, command: 'build' | 'startDev') {
    const outDir = config.outDir ?? (command === 'build' ? 'dist-build' : 'dist-dev');
    return s`${path.resolve(config.rootDir ?? process.cwd(), outDir, BUNDLE_DIR_NAME)}`;
}

/**
 * Create the esbuild plugin that compiles the BrighterScript in rk's staged bundle.
 * @param getConfig returns rk's merged build config for the current build
 */
export function createRokuSdkBrighterScriptPlugin(
    getConfig: () => RokuSdkBuildConfig,
    command: 'build' | 'startDev',
    options: RokuSdkBrighterScriptOptions = {}
): RokuSdkEsbuildPlugin {
    return {
        name: 'brighterscript',
        setup: (build) => {
            build.onEnd(async (result) => {
                //a failed TypeScript build would never be sideloaded anyway, so don't pile more errors on top of it
                if (result.errors.length > 0) {
                    return;
                }
                const config = getConfig();
                await compileBundle({
                    projectRoot: s`${path.resolve(config.rootDir ?? process.cwd())}`,
                    bundleDir: getRokuSdkBundleDir(config, command),
                    staticAssetsDir: getRokuSdkStaticAssetsDir(config),
                    result: result,
                    options: options
                });
            });
        }
    };
}

/**
 * Add BrighterScript compilation to a `roku-config.ts` config, for both `rk build` and `rk dev`.
 *
 * ```ts
 * import { withBrighterScript } from 'brighterscript';
 * export default withBrighterScript({ app: { entryPoint: 'src/index.ts' } });
 * ```
 */
export function withBrighterScript<T extends RokuSdkConfig>(config: T, options: RokuSdkBrighterScriptOptions = {}): T & { pipeline: { build: RokuSdkPipelineSection; startDev: RokuSdkPipelineSection } } {
    //TypeScript apps: run after `assets` (pkg/ is copied, TS-imported XML is copied, unused files are cleaned and the manifest
    //is written) and before `hermes` (which syncs the bundle to pkg-dir). `brsOnly` apps have no named slots; `first` puts this
    //plugin's onEnd ahead of the brs-only packager's onEnd, which is the step that syncs the bundle to pkg-dir.
    const position: RokuSdkPluginPosition = config.app?.brsOnly ? 'first' : { before: 'hermes' };

    const pipeline = { ...config.pipeline } as { build: RokuSdkPipelineSection; startDev: RokuSdkPipelineSection };
    for (const command of ['build', 'startDev'] as const) {
        const section = { ...pipeline[command] };
        const originalPreBuild = section.preBuild;

        //rk hands the merged config (including command-line flags such as `--out-dir`) to preBuild, which runs before every
        //build cycle, so remember it there. Fall back to the roku-config.ts values if rk never calls it.
        let buildConfig: RokuSdkBuildConfig = config;
        section.preBuild = async (ctx) => {
            if (ctx?.config) {
                buildConfig = ctx.config;
            }
            await originalPreBuild?.(ctx);
        };
        section.plugins = [
            ...(section.plugins ?? []),
            {
                plugin: createRokuSdkBrighterScriptPlugin(() => buildConfig, command, options),
                position: position
            }
        ];
        pipeline[command] = section;
    }
    return {
        ...config,
        pipeline: pipeline
    };
}

async function compileBundle(context: {
    projectRoot: string;
    bundleDir: string;
    staticAssetsDir: string;
    result: RokuSdkBuildResult;
    options: RokuSdkBrighterScriptOptions;
}) {
    const { bundleDir, result, options } = context;
    const outDir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-brighterscript-'));
    try {
        const builder = new ProgramBuilder();
        //rk owns the console; never wipe its output
        builder.allowConsoleClearing = false;

        const bsConfig: BsConfig = {
            cwd: context.projectRoot,
            //rk prints its own progress; only surface brighterscript's warnings and errors unless asked for more
            logLevel: 'warn',
            ...options.bsConfig,
            //validate the tree exactly as rk will ship it, so components rk generated from TypeScript are in scope too
            rootDir: bundleDir,
            outDir: outDir,
            watch: false,
            //diagnostics are reported through esbuild below, so rk prints them in its own format
            showDiagnosticsInConsole: false
        };
        if (options.project) {
            bsConfig.project = options.project;
        }
        await builder.run(bsConfig);

        for (const diagnostic of builder.getDiagnostics()) {
            //missing severity means error, matching how the CLI reports it
            const severity = diagnostic.severity ?? DiagnosticSeverity.Error;
            const message = toRokuSdkMessage(diagnostic, bundleDir, context.staticAssetsDir);
            if (severity === DiagnosticSeverity.Error || (options.warningsAsErrors && severity === DiagnosticSeverity.Warning)) {
                result.errors.push(message);
            } else if (severity === DiagnosticSeverity.Warning) {
                result.warnings.push(message);
            }
        }
        //rk's later onEnd steps (hermes/debug-upload, sideload) skip when the result has errors, so this stops the deploy
        if (result.errors.length > 0) {
            return;
        }
        await removeBrighterScriptSources(bundleDir);
        await copyEmittedFiles(outDir, bundleDir);
    } finally {
        await fsExtra.remove(outDir);
    }
}

/**
 * Convert a brighterscript diagnostic to an esbuild message. Diagnostics in files that came from the static assets folder
 * point at that folder rather than rk's staged copy, so editors and problem matchers open the file the developer edits.
 */
function toRokuSdkMessage(diagnostic: BsDiagnostic, bundleDir: string, staticAssetsDir: string): RokuSdkMessage {
    //legacy numeric codes are shown as `bs1001`; newer codes are already descriptive (i.e. `cannot-find-name`)
    const code = typeof diagnostic.code === 'number' ? `bs${diagnostic.code}` : diagnostic.code;
    const message: RokuSdkMessage = {
        id: code,
        pluginName: 'brighterscript',
        text: code !== undefined ? `${diagnostic.message.trim()} (${code})` : diagnostic.message.trim()
    };
    if (!diagnostic.location?.uri) {
        return message;
    }
    let filePath = s`${util.uriToPath(diagnostic.location.uri)}`;
    const relativePath = path.relative(bundleDir, filePath);
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        const sourcePath = s`${staticAssetsDir}/${relativePath}`;
        if (fsExtra.pathExistsSync(sourcePath)) {
            filePath = sourcePath;
        }
    }
    const start = diagnostic.location.range?.start;
    message.location = {
        file: filePath,
        //esbuild lines are 1-based, columns are 0-based
        line: (start?.line ?? 0) + 1,
        column: start?.character ?? 0
    };
    return message;
}

/**
 * Delete the `.bs` and `.d.bs` files rk copied into the bundle; their transpiled `.brs` replaces them
 */
async function removeBrighterScriptSources(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await removeBrighterScriptSources(fullPath);
        } else if (/\.bs$/i.test(entry.name)) {
            await fsExtra.remove(fullPath);
        }
    }
}

/**
 * Copy brighterscript's code output over rk's staged bundle
 */
async function copyEmittedFiles(fromDir: string, toDir: string) {
    for (const entry of await fs.readdir(fromDir, { withFileTypes: true })) {
        const sourcePath = path.join(fromDir, entry.name);
        const destPath = path.join(toDir, entry.name);
        if (entry.isDirectory()) {
            await fsExtra.ensureDir(destPath);
            await copyEmittedFiles(sourcePath, destPath);
        } else if (EMITTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
            await fsExtra.copy(sourcePath, destPath, { overwrite: true });
        }
    }
}
