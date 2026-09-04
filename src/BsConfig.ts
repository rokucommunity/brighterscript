import type { LogLevel } from './logging';

export interface BsConfig {
    /**
     * The inheritance tree for all parent configs used to generate this config. Do not set this, it is computed.
     */
    _ancestors?: string[];

    /**
     * A path to a project file. This is really only passed in from the command line, and should not be present in bsconfig.json files.
     * Prefix with a question mark (?) to prevent throwing an exception if the file does not exist.
     */
    project?: string;

    manifest?: {
        bs_const?: Record<string, boolean | null>;
    };

    /**
     * when set, bsconfig.json loading is disabled
     */
    noProject?: boolean;


    /**
     * Relative or absolute path to another bsconfig.json file that this file should import and then override.
     * Prefix with a question mark (?) to prevent throwing an exception if the file does not exist.
     */
    extends?: string;

    /**
     * Override the current working directory.
     */
    cwd?: string;

    /**
     * The root directory of your Roku project. Defaults to current directory.
     */
    rootDir?: string;

    /**
     * The list of file globs used to find all files for the project
     * If using the {src;dest;} format, you can specify a different destination directory
     * for the matched files in src.
     */
    files?: Array<string | { src: string | string[]; dest?: string }>;

    /**
     * The path where the output zip file should be placed.
     * @default "./out/package.zip"
     */
    outFile?: string;

    /**
     * Creates a zip package. Defaults to true. This setting is ignored when deploy is enabled.
     */
    createPackage?: boolean;

    /**
     * If true, the files are copied to staging. This setting is ignored when deploy is enabled or if createPackage is enabled
     */
    copyToStaging?: boolean;

    /**
     * If true, the server will keep running and will watch and recompile on every file change
     * @default false
     */
    watch?: boolean;

    /**
     * If true, after a successful buld, the project will be deployed to the roku specified in host
     */
    deploy?: boolean;

    /**
     * The host of the Roku that this project will deploy to
     */
    host?: string;

    /**
     * The username to use when deploying to a Roku device
     */
    username?: string;

    /**
     * The password to use when deploying to a Roku device
     */
    password?: string;

    /**
     * Prevent the staging folder from being deleted after creating the package
     * @default false
     */
    retainStagingDir?: boolean;

    /**
     * Prevent the staging folder from being deleted after creating the package
     * @default false
     * @deprecated use `retainStagingDir` instead
     */
    retainStagingFolder?: boolean;

    /**
     * The path to the staging directory (wehre the output files are copied immediately before creating the zip)
     */
    stagingDir?: string;

    /**
     * The path to the staging folder (where all files are copied to right before creating the zip package)
     * @deprecated use `stagingDir` instead
     */
    stagingFolderPath?: string;

    /**
     * A list of error codes the compiler should NOT emit, even if encountered.
     */
    ignoreErrorCodes?: (number | string)[];

    /**
     * A map of error codes with their severity level override (error|warn|info)
     */
    diagnosticSeverityOverrides?: Record<number | string, 'error' | 'warn' | 'info' | 'hint'>;

    /**
     * Emit full paths to files when printing diagnostics to the console. Defaults to false
     */
    emitFullPaths?: boolean;

    /**
     * Emit type definition files (`d.bs`)
     * @default false
     */
    emitDefinitions?: boolean;

    /**
     * If true, removes the explicit type to function's parameters and return (i.e. the `as type` syntax); otherwise keep this information.
     * @default false
     */
    removeParameterTypes?: boolean;

    /**
     * A list of filters used to exclude diagnostics from the output
     */
    diagnosticFilters?: Array<number | string | { src: string; codes: (number | string)[] } | { src: string } | { codes: (number | string)[] }>;

    /**
     * Specify what diagnostic types should be printed to the console. Defaults to 'warn'
     */
    diagnosticLevel?: 'info' | 'hint' | 'warn' | 'error';

    /**
     * Specify how diagnostics should be reported to the console.
     * Accepts a single value or an array. When given an array, each diagnostic is rendered
     * once per entry (so you can, for example, get both detailed terminal output and
     * github-actions PR annotations from a single run).
     *
     * Each value may be a preset name ('detailed', 'github-actions'), a custom template string
     * (any string containing a `{` placeholder), or an object with explicit `type`.
     *
     * Custom templates support the following placeholders, replaced per diagnostic:
     *   {file}, {line}, {col}, {endLine}, {endCol}, {severity}, {code}, {message}, {source}
     *
     * Examples:
     *   "detailed"
     *   "github-actions"
     *   "{file}:{line}:{col} {severity} {code}: {message}"
     *   { type: "custom", format: "{file}:{line}: {message}" }
     *   ["detailed", "github-actions"]
     *
     * @default "detailed"
     */
    diagnosticReporters?: DiagnosticReporter | DiagnosticReporter[];
    /**
     * A list of scripts or modules to add extra diagnostics or transform the AST
     */
    plugins?: Array<string>;

    /**
     * A list of scripts or modules to pass to node's `require()` on startup. This is useful for doing things like ts-node registration
     */
    require?: Array<string>;

    /**
     * When enabled, every xml component will search for a .bs or .brs file with the same name
     * in the same folder, and add it as a script import if found. Disabled by default"
     */
    autoImportComponentScript?: boolean;
    /**
     * When enabled, diagnostics will be printed to the console.
     * When disabled, no diagnostics will be printed to the console.
     * @default true
     */
    showDiagnosticsInConsole?: boolean;
    /**
     * The log level.
     * @default LogLevel.log
     */
    logLevel?: LogLevel | 'error' | 'warn' | 'log' | 'info' | 'debug' | 'trace' | 'off';
    /**
     * Overrides where source files appear to live, in both sourcemaps and the `SOURCE_FILE_PATH` /
     * `SOURCE_LOCATION` runtime literals. Only applies to files within `rootDir`.
     *
     * When `relativeSourceMaps` is false (default): the `rootDir` portion of each source path is
     * replaced with `sourceRoot` directly in `sources[]`. The map's `sourceRoot` field is not written.
     *
     * When `relativeSourceMaps` is true: the map's `sourceRoot` field is set to this value, and
     * `sources[]` entries are relative to `sourceRoot` (per the sourcemap spec).
     *
     * In both modes, `SOURCE_FILE_PATH` and `SOURCE_LOCATION` reflect the `sourceRoot`-substituted path.
     */
    sourceRoot?: string;
    /**
     * Should the `sourceRoot` property be resolve to an absolute path (relative to the bsconfig it's defined in)
     * @default false
     */
    resolveSourceRoot?: boolean;
    /**
     * Enables generating sourcemap files, which allow debugging tools to show the original source code while running the emitted files.
     * @default true
     */
    sourceMap?: boolean;
    /**
     * If true, file paths in sourcemap `sources[]` will be written as relative paths instead of absolute.
     * Only has an effect when `sourceMap` is true.
     *
     * When false (default): `sources[]` contains absolute paths. If `sourceRoot` is set, the `rootDir`
     * portion is replaced with `sourceRoot` in-place; the map's `sourceRoot` field is never written.
     *
     * When true: `sources[]` entries are relative to the map file's directory, making sourcemaps
     * portable across machines. If `sourceRoot` is also set, the map's `sourceRoot` field is written
     * and `sources[]` entries are instead relative to `sourceRoot` (per the sourcemap spec — consumers
     * reconstruct the full path as `path.resolve(sourceRoot, sources[0])`).
     * @default false
     */
    relativeSourceMaps?: boolean;
    /**
     * Excludes empty files from being included in the output. Some Brighterscript files
     * are left empty or with only comments after transpilation to Brightscript.
     * The default behavior is to write these to disk after transpilation.
     * Setting this flag to `true` will prevent empty files being written and will
     * remove associated script tags from XML
     * @default false
     */
    pruneEmptyCodeFiles?: boolean;
    /**
     * Allow brighterscript features (classes, interfaces, etc...) to be included in BrightScript (`.brs`) files, and force those files to be transpiled.
     * @default false
     */
    allowBrighterScriptInBrightScript?: boolean;

    /**
     * Override the destination directory for the bslib.brs file.  Use this if
     * you want to customize where the bslib.brs file is located in the staging
     * directory.  Note that using a location outside of `source` will break
     * scripts inside `source` that depend on bslib.brs.  Defaults to `source`.
     */
    bslibDestinationDir?: string;

    /**
     * The minimum Roku firmware version required to run this project.
     * When set, BrightScript (.brs) files are always validated against the version restriction.
     * BrighterScript (.bs) files are only validated for features that BrighterScript does not
     * transpile — for example, optional chaining is emitted as-is, so it is subject to the
     * restriction. Features that BrighterScript fully transpiles (such as classes) are not
     * restricted, since the transpiled output is compatible with older firmware.
     * Should be a semver-compatible string (e.g. "11.0.0").
     */
    minFirmwareVersion?: string;

    /**
     * When set to false, validation is skipped entirely. This can speed up builds when diagnostics
     * are not needed (e.g. when using the VSCode extension which already surfaces diagnostics in the
     * editor). Note that skipping validation may cause transpilation to fail or produce incorrect
     * output if the project contains errors that would normally be caught during validation.
     * @default true
     */
    validate?: boolean;
}

/**
 * Discriminated union describing how diagnostics are rendered to the console.
 * - String shorthand: a preset name ('detailed' | 'github-actions') or a template string
 *   (any string containing a `{` is treated as a custom template).
 * - Object form: explicit `type` so config files can stay strictly typed.
 */
export type DiagnosticReporter =
    | 'detailed'
    | 'github-actions'
    // eslint-disable-next-line @typescript-eslint/ban-types -- string & {} preserves autocomplete for the literals above
    | (string & {})
    | { type: 'detailed' }
    | { type: 'github-actions' }
    | { type: 'custom'; format: string };

/**
 * Object form of `DiagnosticReporter` after string shorthand has been resolved.
 */
export type NormalizedDiagnosticReporter =
    | { type: 'detailed' }
    | { type: 'github-actions' }
    | { type: 'custom'; format: string };

type OptionalBsConfigFields =
    | '_ancestors'
    | 'sourceRoot'
    | 'project'
    | 'manifest'
    | 'noProject'
    | 'extends'
    | 'host'
    | 'password'
    | 'require'
    | 'stagingFolderPath'
    | 'diagnosticLevel'
    | 'rootDir'
    | 'stagingDir'
    | 'minFirmwareVersion'
    | 'diagnosticReporters';

export type FinalizedBsConfig =
    Omit<Required<BsConfig>, OptionalBsConfigFields>
    & Pick<BsConfig, OptionalBsConfigFields>;
