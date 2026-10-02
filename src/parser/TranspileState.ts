import { SourceNode } from 'source-map';
import type { Location, Position } from 'vscode-languageserver';
import type { BsConfig } from '../BsConfig';
import { TokenKind } from '../lexer/TokenKind';
import type { Locatable, SourceInfo, Token } from '../lexer/Token';
import type { RangeLike } from '../util';
import { util } from '../util';
import type { TranspileResult } from '../interfaces';

interface TranspileToken {
    pos?: number;
    end?: number;
    source?: SourceInfo;
    /**
     * Location for tokens that aren't `Locatable` (i.e. SGTokens)
     */
    location?: Location;
    text: string;
    kind?: TokenKind;
    leadingTrivia?: Array<TranspileToken>;
}

/**
 * Holds the state of a transpile operation as it works its way through the transpile process
 */
export class TranspileState {
    constructor(
        /**
         * The absolute path to the source location of this file. If sourceRoot is specified,
         * this path will be the full path to the file under sourceRoot instead of rootDir.
         * If the file resides outside of rootDir, then no changes will be made to this path.
         * Used for runtime source literals (SOURCE_FILE_PATH, SOURCE_LOCATION).
         */
        public srcPath: string,
        public options: BsConfig
    ) {
        //if a sourceRoot is specified, swap rootDir for sourceRoot in the path for runtime literals
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

    private getSource(locatable: RangeLike) {
        let srcPath = (locatable as Locatable)?.source?.uri ?? (locatable as { location: Location })?.location?.uri ?? (locatable as Location).uri;
        if (srcPath) {
            srcPath = util.uriToPath(srcPath);
            //if a sourceRoot is specified, use that instead of the rootDir
            if (this.options.sourceRoot) {
                srcPath = srcPath.replace(
                    this.options.rootDir,
                    this.options.sourceRoot
                );
            }
            return srcPath;
        } else {
            return this.srcPath;
        }
    }

    /**
     * Shorthand for creating a new source node
     */
    public sourceNode(locatable: RangeLike, code: string | SourceNode | TranspileResult): SourceNode {
        //source maps only need the start, so skip building a whole `Location` for locatables
        const start = (locatable && 'source' in locatable)
            ? util.getStartPosition(locatable)
            : util.extractRange(locatable)?.start;
        return util.sourceNodeFromTranspileResult(
            //convert 0-based range line to 1-based SourceNode line
            start ? start.line + 1 : null,
            //range and SourceNode character are both 0-based, so no conversion necessary
            start ? start.character : null,
            this.getSource(locatable),
            code
        );
    }

    /**
     * Create a SourceNode from a token. This is more efficient than the above `sourceNode` function
     * because the entire token is passed by reference, instead of the raw string being copied to the parameter,
     * only to then be copied again for the SourceNode constructor
     */
    public tokenToSourceNode(token: TranspileToken, start = this.getTokenStart(token)) {
        return new SourceNode(
            //convert 0-based range line to 1-based SourceNode line
            start ? start.line + 1 : null,
            //range and SourceNode character are both 0-based, so no conversion necessary
            start ? start.character : null,
            this.getSource(token),
            token.text
        );
    }

    /**
     * Get the start position of a token. Source maps only need the start, so this skips building a whole `Location`
     */
    private getTokenStart(token: TranspileToken): Position | undefined {
        return token?.source
            ? util.getStartPosition(token as Locatable)
            : token?.location?.range?.start;
    }

    /**
     * Does this token span more than one line? (a trailing newline doesn't count)
     */
    private isMultiLine(token: TranspileToken, start: Position) {
        if (token.source) {
            const nextLineStart = token.source.lineStarts[start.line + 1];
            return nextLineStart !== undefined && nextLineStart <= util.getContentEnd(token as Locatable);
        }
        return token.location?.range?.end?.line > start.line;
    }

    public transpileLeadingCommentsForAstNode(node: { leadingTrivia?: Token[] }) {
        const leadingTrivia = node?.leadingTrivia ?? [];
        if (!leadingTrivia || leadingTrivia.length === 0) {
            return [];
        }
        const leadingCommentsSourceNodes = this.transpileComments(leadingTrivia);
        if (leadingCommentsSourceNodes.length > 0) {
            // indent in preparation for next text
            leadingCommentsSourceNodes.push(this.indent());
        }

        return leadingCommentsSourceNodes;
    }

    public transpileLeadingComments(token: TranspileToken) {
        const leadingTrivia = token?.leadingTrivia ?? [];
        if (!leadingTrivia || leadingTrivia.length === 0) {
            return [];
        }
        const leadingCommentsSourceNodes = this.transpileComments(leadingTrivia);
        if (leadingCommentsSourceNodes.length > 0 && token.text) {
            // indent in preparation for next text
            leadingCommentsSourceNodes.push(this.indent());
        }

        return leadingCommentsSourceNodes;
    }

    public transpileComments(tokens: TranspileToken[], prepNextLine = false): Array<string | SourceNode> {
        const leadingCommentsSourceNodes = [];
        if (!tokens) {
            return leadingCommentsSourceNodes;
        }
        const justComments = tokens.filter(t => t.kind === TokenKind.Comment || t.kind === TokenKind.Newline);
        let newLinesSinceComment = 0;

        let transpiledCommentAlready = false;
        for (const commentToken of justComments) {
            if (commentToken.kind === TokenKind.Newline && !transpiledCommentAlready) {
                continue;
            }
            if (commentToken.kind === TokenKind.Comment) {
                if (leadingCommentsSourceNodes.length > 0) {
                    leadingCommentsSourceNodes.push(this.indent());
                }
                leadingCommentsSourceNodes.push(this.tokenToSourceNode(commentToken));
                newLinesSinceComment = 0;
            } else {
                newLinesSinceComment++;
            }

            if (newLinesSinceComment === 1 || newLinesSinceComment === 2) {
                //new line that is not touching a previous new line
                leadingCommentsSourceNodes.push(this.newline);
            }
            transpiledCommentAlready = true;
        }
        //if we should prepare for the next line, add an indent (only if applicable)
        if (prepNextLine && transpiledCommentAlready) {
            leadingCommentsSourceNodes.push(this.indent());
        }
        return leadingCommentsSourceNodes;
    }

    /**
     * Create a SourceNode from a token, accounting for missing range and multi-line text
     * Adds all leading trivia for the token
     */
    public transpileToken(token: TranspileToken, defaultValue?: string, commentOut = false, skipLeadingComments = false): TranspileResult {
        const leadingCommentsSourceNodes = skipLeadingComments ? [] : this.transpileLeadingComments(token);
        const commentIfCommentedOut = commentOut ? `'` : '';

        if (!token?.text && defaultValue !== undefined) {
            return [new SourceNode(null, null, null, [...leadingCommentsSourceNodes, commentIfCommentedOut, defaultValue])];
        }

        const start = this.getTokenStart(token);
        if (!start) {
            return [new SourceNode(null, null, null, [...leadingCommentsSourceNodes, commentIfCommentedOut, token.text])];
        }
        //split multi-line text
        if (this.isMultiLine(token, start)) {
            const lines = token.text.split(/\r?\n/g);
            const code = [
                this.sourceNode(token, [...leadingCommentsSourceNodes, commentIfCommentedOut, lines[0]])
            ] as Array<string | SourceNode>;
            for (let i = 1; i < lines.length; i++) {
                code.push(
                    this.newline,
                    commentIfCommentedOut,
                    new SourceNode(
                        //convert 0-based range line to 1-based SourceNode line
                        start.line + i + 1,
                        //SourceNode column is 0-based, and this starts at the beginning of the line
                        0,
                        this.getSource(token),
                        lines[i]
                    )
                );
            }
            return [new SourceNode(null, null, null, code)];
        } else {
            return [...leadingCommentsSourceNodes, commentIfCommentedOut, this.tokenToSourceNode(token, start)];
        }
    }

    public transpileEndBlockToken(previousLocatable: RangeLike, endToken: Token, defaultValue: string, alwaysAddNewlineBeforeEndToken = true) {
        const result = [];

        if (util.hasLeadingComments(endToken)) {
            // add comments before `end token` - they should be indented
            if (util.isLeadingCommentOnSameLine(previousLocatable, endToken)) {
                this.blockDepth++;
                result.push(' ');
            } else {
                result.push(this.newline);
                result.push(this.indent(1));
            }
            result.push(...this.transpileToken({ ...endToken, text: '' }));
            this.blockDepth--;
            result.push(this.indent());
        } else if (alwaysAddNewlineBeforeEndToken) {
            result.push(this.newline, this.indent());
        }
        result.push(this.transpileToken({ ...endToken, leadingTrivia: [] }, defaultValue));
        return result;
    }
}
