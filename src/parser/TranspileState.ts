import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import type { BsConfig } from '../BsConfig';
import type { Token } from '../lexer/Token';
import type { TranspileResult } from '../interfaces';
import util from '../util';

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
     * Ensures a token has some leading whitespace. If the token already has leadingTrivia or leadingWhitespace,
     * returns the token as-is. If the token has a range (was parsed from source), returns it as-is to preserve
     * original formatting. Otherwise, returns a token with the specified default whitespace.
     * This is useful for plugin-contributed tokens that may be missing proper trivia.
     *
     * @param token The token to ensure has whitespace
     * @param defaultWhitespace The whitespace to add if none exists (defaults to ' ')
     * @returns A token guaranteed to have some form of leading whitespace (if it's synthetic/plugin-contributed)
     */
    public ensureLeadingWhitespace<T extends { leadingTrivia?: Token[]; leadingWhitespace?: string; range?: Range }>(
        token: T,
        defaultWhitespace = ' '
    ): T {
        if (!token) {
            return token;
        }

        // If token already has trivia or whitespace, use it as-is
        if (token.leadingTrivia?.length > 0 || token.leadingWhitespace) {
            return token;
        }

        // If token has a range, it was parsed from source code - preserve original formatting (even if no space)
        // Only inject whitespace for synthetic/plugin-contributed tokens (no range)
        if (token.range) {
            return token;
        }

        // Token is synthetic/plugin-contributed and missing trivia - add default whitespace
        return {
            ...token,
            leadingWhitespace: defaultWhitespace
        };
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
    public sourceNode(locatable: { range?: Range }, code: string | SourceNode | TranspileResult): SourceNode {
        return util.sourceNodeFromTranspileResult(
            //convert 0-based range line to 1-based SourceNode line
            locatable.range ? locatable.range.start.line + 1 : null,
            //range and SourceNode character are both 0-based, so no conversion necessary
            locatable.range ? locatable.range.start.character : null,
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
            token.range ? token.range.start.line + 1 : null,
            //range and SourceNode character are both 0-based, so no conversion necessary
            token.range ? token.range.start.character : null,
            this.srcPath,
            token.text
        );
    }

    /**
     * Create a SourceNode from a token. This is more efficient than the above `sourceNode` function
     * because the entire token is passed by reference, instead of the raw string being copied to the parameter,
     * only to then be copied again for the SourceNode constructor.
     *
     * This method automatically sanitizes tokens that may be missing proper trivia (e.g., from plugins),
     * ensuring they have at least empty arrays and handling leadingWhitespace gracefully.
     */
    public tokenToSourceNodeWithTrivia(token: { range?: Range; text: string; leadingTrivia?: Token[]; leadingWhitespace?: string }) {
        if (!token) {
            return new SourceNode(1, 0, null, []);
        }

        const result: SourceNode[] = [];

        // Sanitize the token - ensure leadingTrivia exists even if plugins didn't set it
        const sanitizedTrivia = token.leadingTrivia ?? [];

        // Handle leadingWhitespace if it exists but wasn't captured in leadingTrivia
        // This can happen with plugin-contributed tokens that don't properly set trivia
        if (token.leadingWhitespace && sanitizedTrivia.length === 0) {
            // Create a synthetic whitespace token to preserve spacing
            result.push(new SourceNode(1, 0, null, token.leadingWhitespace));
        }

        // Process all leading trivia tokens
        for (const triviaItem of sanitizedTrivia) {
            if (triviaItem?.range && triviaItem.text !== undefined) {
                result.push(new SourceNode(
                    triviaItem.range.start.line + 1,
                    triviaItem.range.start.character,
                    this.srcPath,
                    triviaItem.text
                ));
            }
        }

        // Add the main token
        if (token.range && token.text !== undefined) {
            result.push(new SourceNode(
                token.range.start.line + 1,
                token.range.start.character,
                this.srcPath,
                token.text
            ));
        } else if (token.text !== undefined) {
            // Token without range - still output the text
            result.push(new SourceNode(1, 0, null, token.text));
        }

        return new SourceNode(1, 0, null, result);
    }

    /**
     * Create a SourceNode from a token, accounting for missing range and multi-line text
     */
    public transpileToken(token: { range?: Range; text: string }, defaultValue?: string) {
        if (!token?.text && defaultValue !== undefined) {
            return defaultValue;
        }

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
     * @param elements the items that have a `toSourceNode()` function
     * @param filter a function to call to EXCLUDE an item. It's an exclude filter so you can pass in things like `isCommentStatement` directly
     */
    public arrayToSourceNodeWithTrivia<TElement extends { toSourceNode: (state: TranspileState) => SourceNode }>(elements: Array<TElement>, filter?: (element: TElement) => boolean) {
        const nodes: Array<SourceNode | string> = [];
        if (Array.isArray(elements)) {
            for (const element of elements) {
                if (element && !filter?.(element)) {
                    nodes.push(
                        element?.toSourceNode(this) ?? ''
                    );
                }
            }
        }
        return new SourceNode(1, 0, null, nodes);
    }
}
