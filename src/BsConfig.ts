import type { LogLevel } from './Logger';

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
     * The path to the staging directory (wehre the output files are copied immediately before creating the zip)
     */
    stagingDir?: string;

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
    logLevel?: LogLevel | 'error' | 'warn' | 'log' | 'info' | 'debug' | 'trace';
    /**
     * Override the path to source files in source maps. Use this if you have a preprocess step and want
     * to ensure the source maps point to the original location.
     * This will only alter source maps for files within rootDir. Any files found outside of rootDir will not
     * have their source maps changed. This option also affects the `SOURCE_FILE_PATH` and `SOURCE_LOCATION` source literals.
     */
    sourceRoot?: string;
    /**
     * Enables generating sourcemap files, which allow debugging tools to show the original source code while running the emitted files.
     * @default true
     */
    sourceMap?: boolean;

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
}
