
export interface BsConfig {
    /**
     * The inheritance tree for all parent configs used to generate this config. Do not set this, it is computed.
     */
    _ancestors?: string[];
    /**
     * A path to a project file. This is really only passed in from the command line, and should not be present in bsconfig.json files
     */
    project?: string;
    /**
     * Relative or absolute path to another bsconfig.json file that this file should import and then override
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
    files?: Array<string | string[] | { src: string | string[]; dest?: string }>;
    /**
     * The path where the output zip file should be placed.
     * @default "./out/package.zip"
     */
    outFile?: string;
    /**
     * Prevents the zip file from being created. This has no effect if deploy is true.
     */
    skipPackage?: boolean;
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
     * A list of error codes the compiler should NOT emit, even if encountered.
     */
    ignoreErrorCodes?: number[];

    /**
     * Emit full paths to files when printing diagnostics to the console. Defaults to false
     */
    emitFullPaths?: boolean;
    /**
     * Prevent the staging folder from being deleted after creating the package
     * @default false
     */
    retainStagingFolder?: boolean;
}
