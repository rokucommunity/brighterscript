import type { BsDiagnostic, CommentFlag } from '../interfaces';

export interface File {
    /**
     * A string name representing the file type. This is generally the class name (i.e. 'BrsFile', 'XmlFile')
     */
    type: string;
    /**
     * The pkgPath to the file (without the `pkg:` prefix)
     */
    pkgPath: string;
    /**
     * The absolute path to the source file
     */
    srcPath: string;
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
     * This affects setting affects whether the file is transpiled, or copied, or completely excluded.
     * `true` means exclude, all other values mean include.
     */
    excludeFromOutput?: boolean;
}
//included for backwards compatibility reasons
export type BscFile = File;

export function createFile(props: Partial<File>) {
    props.diagnostics ??= [];
    props.dependencies ??= [];
    props.dependencyGraphKey ??= props.pkgPath;
    props.disposables ??= [];
    return props as File;
}
