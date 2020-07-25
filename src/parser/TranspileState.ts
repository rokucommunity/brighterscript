import { SourceNode } from 'source-map';
import { ClassStatement } from './ClassStatement';
import { Range } from 'vscode-languageserver';
import { BrsFile } from '../files/BrsFile';

/**
 * Holds the state of a transpile operation as it works its way through the transpile process
 */
export class TranspileState {
    constructor(
        file: BrsFile
    ) {
        this.file = file;

        //if a sourceRoot is specified, use that instead of the rootDir
        if (this.options.sourceRoot) {
            this.pathAbsolute = this.file.pathAbsolute.replace(
                this.options.rootDir,
                this.options.sourceRoot
            );
        } else {
            this.pathAbsolute = this.file.pathAbsolute;
        }
    }

    /**
     * The BrsFile that is currently being transpiled
     */
    public file: BrsFile;

    /**
     * The absolute path to the source location of this file. If sourceRoot is specified,
     * this path will be full path to the file in sourceRoot instead of rootDir.
     * If the file resides outside of rootDir, then no changes will be made to this path.
     */
    public pathAbsolute: string;

    /**
     * The number of active parent blocks for the current location of the state.
     */
    blockDepth = 0;
    /**
     * the tree of parents, with the first index being direct parent, and the last index being the furthest removed ancestor.
     * Used to assist blocks in knowing when to add a comment statement to the same line as the first line of the parent
     */
    lineage = [] as Array<{
        range: Range;
    }>;

    /**
     * Used by ClassMethodStatements to determine information about their enclosing class
     */
    public classStatement?: ClassStatement;

    /**
     * Append whitespace until we reach the current blockDepth amount
     * @param state
     */
    public indent() {
        let totalSpaceCount = this.blockDepth * 4;
        totalSpaceCount = totalSpaceCount > -1 ? totalSpaceCount : 0;
        return ' '.repeat(totalSpaceCount);
    }

    public newline() {
        return '\n';
    }

    /**
     * shortcut access to the program's options
     */
    public get options() {
        return this.file.program.options;
    }

    /**
     * Shorthand for creating a new source node
     */
    public sourceNode(locatable: { range: Range }, code: string) {
        let result = new SourceNode(
            locatable.range.start.line,
            locatable.range.start.character,
            this.pathAbsolute,
            code
        );
        return code || result;
    }
}
