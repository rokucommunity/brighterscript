
export interface TranspileState {
    //the path for this file relative to the root of the output package
    pkgPath: string;
    //the absolute path to the source location of this file
    pathAbsolute: string;
    /**
     * How many enclosing blocks are above this. Used for indentation. This is NOT the number of spaces,
     * but rather the number of blocks
     */
    blockDepth: number;
    /**
     * the tree of parents, with the first index being direct parent, and the last index being the furthest removed ancestor.
     * Used to assist blocks in knowing when to add a comment statement to the same line as the first line of the parent
     */
    lineage: Array<{
        location: Location;
    }>;
}

/**
 * Create a newline (including leading spaces)
 * @param state
 */
export function indent(state: TranspileState) {
    let result = '';
    let totalSpaceCount = state.blockDepth * 4;
    totalSpaceCount = totalSpaceCount > -1 ? totalSpaceCount : 0;
    for (let i = 0; i < totalSpaceCount; i++) {
        result += ' ';
    }
    return result;
}
