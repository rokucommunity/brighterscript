import { SourceNode } from 'source-map';
import { Location } from '../lexer';
import { BrsFile } from '../../files/BrsFile';
import { ClassStatement } from './ClassStatement';

/**
 * Holds the state of a transpile operation as it works its way through the transpile process
 */
export class TranspileState {
    constructor(
        file: BrsFile
    ) {
        this.file = file;
    }
    /**
     * The BrsFile that is currently being transpiled
     */
    file: BrsFile;
    /**
     * the path for this file relative to the root of the output package
     */
    get pkgPath() {
        return this.file.pkgPath;
    }
    /**
     * the absolute path to the source location of this file
     */
    get pathAbsolute() {
        return this.file.pathAbsolute;
    }
    /**
     * The number of active parent blocks for the current location of the state.
     */
    blockDepth = 0;
    /**
     * the tree of parents, with the first index being direct parent, and the last index being the furthest removed ancestor.
     * Used to assist blocks in knowing when to add a comment statement to the same line as the first line of the parent
     */
    lineage = [] as Array<{
        location: Location;
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

    /**
     * Get a newline and an indent together
     */
    public newline() {
        return '\n';
    }

    /**
     * Shorthand for creating a new source node
     */
    public sourceNode(locatable: { location: Location }, code: string) {
        let result = new SourceNode(
            locatable.location.start.line,
            locatable.location.start.column,
            this.pathAbsolute,
            code
        );
        return code || result;
    }
}
