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
