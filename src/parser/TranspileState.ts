import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import type { BsConfig } from '../BsConfig';
import { Token } from '../lexer/Token';

/**
 * Holds the state of a transpile operation as it works its way through the transpile process
 */
export class TranspileState {
    constructor(
        /**
         * The absolute path to the source location of this file. If sourceRoot is specified,
         * this path will be full path to the file in sourceRoot instead of rootDir.
         * If the file resides outside of rootDir, then no changes will be made to this path.
         */
        public srcPath: string,
        public options: BsConfig
    ) {
        this.srcPath = srcPath;

        //if a sourceRoot is specified, use that instead of the rootDir
        if (this.options.sourceRoot) {
            this.srcPath = this.srcPath.replace(
                this.options.rootDir,
                this.options.sourceRoot
            );
        }
    }

    public indentText = '';

    /**
     * Append whitespace until we reach the current blockDepth amount
     * @param blockDepthChange - if provided, this will add (or subtract if negative) the value to the block depth BEFORE getting the next indent amount.
     */
    public indent(blockDepthChange = 0) {
        this.blockDepth += blockDepthChange;
        return this.indentText;
    }

    /**
     * The number of active parent blocks for the current location of the state.
     */
    get blockDepth() {
        return this._blockDepth;
    }
    set blockDepth(value: number) {
        this._blockDepth = value;
        this.indentText = value === 0 ? '' : '    '.repeat(value);
    }
    private _blockDepth = 0;

    public newline = '\n';

    /**
     * Shorthand for creating a new source node
     */
    public sourceNode(locatable: { range?: Range }, code: string | SourceNode | Array<string | SourceNode>): SourceNode | undefined {
        return new SourceNode(
            //convert 0-based range line to 1-based SourceNode line
            locatable.range.start.line + 1,
            //range and SourceNode character are both 0-based, so no conversion necessary
            locatable.range.start.character,
            this.srcPath,
            code
        );
    }

    /**
     * Shorthand for creating a container SourceNode (one that doesn't have a location)
     */
    public toSourceNode(...chunks: Array<string | SourceNode>) {
        return new SourceNode(
            //convert 0-based range line to 1-based SourceNode line
            1,
            //range and SourceNode character are both 0-based, so no conversion necessary
            0,
            null,
            chunks.filter(x => !!x)
        );
    }

    /**
     * Create a SourceNode from a token. This is more efficient than the above `sourceNode` function
     * because the entire token is passed by reference, instead of the raw string being copied to the parameter,
     * only to then be copied again for the SourceNode constructor
     */
    public tokenToSourceNode(token: { range?: Range; text: string }) {
        return new SourceNode(
            //convert 0-based range line to 1-based SourceNode line
            token.range.start.line + 1,
            //range and SourceNode character are both 0-based, so no conversion necessary
            token.range.start.character,
            this.srcPath,
            token.text
        );
    }

    /**
     * Create a SourceNode from a token. This is more efficient than the above `sourceNode` function
     * because the entire token is passed by reference, instead of the raw string being copied to the parameter,
     * only to then be copied again for the SourceNode constructor
     */
    public tokenToSourceNodeWithTrivia(token: { range?: Range; text: string; leadingTrivia: Token[] }) {
        const result: SourceNode[] = [];
        for (const item of [...token?.leadingTrivia ?? [], token]) {
            if (token) {
                result.push(new SourceNode(
                    //convert 0-based range line to 1-based SourceNode line
                    item.range.start.line + 1,
                    //range and SourceNode character are both 0-based, so no conversion necessary
                    item.range.start.character,
                    this.srcPath,
                    item.text
                ));
            }
        }
        return new SourceNode(1, 0, null, result);
    }

    /**
     * Create a SourceNode from a token, accounting for missing range and multi-line text
     */
    public transpileToken(token: { range?: Range; text: string }) {
        if (!token.range) {
            return token.text;
        }
        //split multi-line text
        if (token.range.end.line > token.range.start.line) {
            const lines = token.text.split(/\r?\n/g);
            const code = [
                this.sourceNode(token, lines[0])
            ] as Array<string | SourceNode>;
            for (let i = 1; i < lines.length; i++) {
                code.push(
                    this.newline,
                    new SourceNode(
                        //convert 0-based range line to 1-based SourceNode line
                        token.range.start.line + i + 1,
                        //SourceNode column is 0-based, and this starts at the beginning of the line
                        0,
                        this.srcPath,
                        lines[i]
                    )
                );
            }
            return new SourceNode(null, null, null, code);
        } else {
            return this.tokenToSourceNode(token);
        }
    }

    /**
     * Convert an array of `toSourceNode`-enabled objects to a single SourceNode, applying an optional filter as they are iterated
     * @param filter a function to call to EXCLUDE an item. It's an exclude filter so you can pass in things like `isCommentStatement` directly
     */
    public arrayToSourceNodeWithTrivia<TElement extends { toSourceNode: (state: TranspileState) => SourceNode }>(elements: Array<TElement>, filter?: (element: TElement) => boolean) {
        const nodes: Array<SourceNode | string> = [];
        for (const element of elements) {
            if (element && !filter?.(element)) {
                nodes.push(
                    element?.toSourceNode(this) ?? ''
                );
            }
        }
        return new SourceNode(1, 0, null, nodes);
    }
}
