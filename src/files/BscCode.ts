import type { Range } from 'vscode-languageserver';
import type { CommentFlag } from '../interfaces';
import type { Program } from '../Program';
import type { BscFile } from './BscFile';

/**
 * A piece of code that a file provides (i.e. the BrightScript in a `.brs` file, or the SceneGraph component in a `.xml` file).
 * The code holds everything about itself (tokens, AST, symbols, etc.), while the file it lives in (its `document`)
 * holds the paths, contents, dependencies and output.
 */
export interface BscCode {
    /**
     * A string name representing the code type. This is generally the class name (i.e. 'BrsCode', 'XmlCode')
     */
    type: string;
    /**
     * The file this code lives in
     */
    document: BscFile;
    program: Program;
    /**
     * A key that identifies this code in the program. It stays the same when the code is re-parsed or its file is replaced,
     * so information about the code (i.e. the symbols it provides) can be compared across validations.
     * Code that covers a whole file uses the file's `pkgPath`.
     */
    readonly key: string;
    /**
     * The absolute path to the file this code lives in
     */
    readonly srcPath: string;
    /**
     * The path to the file this code lives in, relative to the root of the package (retaining its original file extension)
     */
    readonly destPath: string;
    /**
     * The final path in the package of the file this code lives in
     */
    readonly pkgPath: string;
    /**
     * The region of the document this code covers. Undefined means this code covers the whole document.
     */
    range?: Range;
    /**
     * Comment-based flags found in this code, used to suppress diagnostics
     */
    commentFlags: CommentFlag[];
    /**
     * Indicates whether this code has been validated
     */
    isValidated: boolean;
    /**
     * Tokenize and parse this code
     */
    parse(text: string): void;
    /**
     * Dispose of any resources this code created
     */
    dispose?(): void;
}
