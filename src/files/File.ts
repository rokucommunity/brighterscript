import type { BsDiagnostic, CommentFlag } from '../interfaces';

export interface File {
    /**
     * A string name representing the file type. This is generally the class name (i.e. 'BrsFile', 'XmlFile')
     */
    type: string;
    /**
     * The absolute path to the source file.
     * @example "C:\projects\YourRokuApp\source\main.bs" or "/mnt/projects/YourRokuApp/source/main.bs"
     */
    srcPath: string;
    /**
     * The path where the file exists within the context of a brightscript program, relative ot the root of the package/zip.
     * This is the path that you will reference within your code.
     * Generally this is the same as `pkgPath`, but can be different (as shown in the example below):
     *
     * **NOTE:** This should _not_ containing a leading slash or `pkg:/` scheme
     * @example
     * {
     *    //given this srcPath:
     *    srcPath: "C:/projects/YourRokuApp/source/main.bs",
     *    //destPath should be:
     *    destPath: "source/main.bs"
     * }
     */
    destPath?: string; // "images\\profile.png"
    /**
     * The path to the file within the package, relative to the root of the package/zip.
     *
     * **NOTE:** This should _not_ containing a leading slash or `pkg:/` scheme
     * @example
     * {
     *    //given this srcPath:
     *    srcPath: "C:/projects/YourRokuApp/source/main.bs",
     *    //pkgPath should be:
     *    pkgPath: "source/main.brs" //(note the `.brs` file extension)
     * }
     */
    pkgPath: string; // "images\\profile.jpg"   file.bs   file.brs
    /**
     * The key used to identify this file in the dependency graph.
     * If omitted, the pkgPath is used.
     */
    dependencyGraphKey?: string;
    /**
     * An array of dependencyGraphKeys of items this file depends on.
     */
    dependencies?: string[];
    /**
     * Called when any of this file's dependencies change (i.e. file depends on `a.brs`, and `a.brs` changes)
     */
    onDependenciesChanged?: () => void;
    /**
     * A list of diagnostics associated with this file
     */
    diagnostics?: BsDiagnostic[];
    /**
     * Indicates whether the file has been validated. This flag is auto-set by the program during the validation cycle.
     * You can set this to `true` to skip validation for this file or if you've validated the file yourself already
     */
    isValidated?: boolean;
    /**
     * Called when the file needs to be validated
     */
    validate?: () => void;
    /**
     * Does this file need to be transpiled?
     * TODO do we need this property?
     */
    needsTranspiled?: boolean;
    /**
     * An array of comment-based flags that can be used to suppress diagnostics
     */
    commentFlags?: CommentFlag[];
    /**
     * An array of functions that will be called when this file gets destroyed (i.e. event handler disconnection functions)
     */
    disposables?: Array<() => void>;
    /**
     * Dispose of any resources the file may have created.
     */
    dispose?(): void;
    /**
     * Should this file be included or excluded when generating the project output (i.e. transpiling the project)
     * This affects whether the file is transpiled, or copied, or completely excluded.
     * `true` means exclude, all other values mean include.
     */
    excludeFromOutput?: boolean;
}
/**
 * @deprecated use `File` instead
 */
//included for backwards compatibility reasons. Remove in v1
export type BscFile = File;

export function createFile(props: Partial<File>) {
    props.diagnostics ??= [];
    props.dependencies ??= [];
    props.dependencyGraphKey ??= props.pkgPath;
    props.disposables ??= [];
    return props as File;
}
