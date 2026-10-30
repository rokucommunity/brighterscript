import type { Location, Range } from 'vscode-languageserver';
import type { SourceInfo, Token } from './Token';
import { ReservedTokenKinds } from './TokenKind';
import type { TokenKind } from './TokenKind';
import util from '../util';

/**
 * The `leadingTrivia` of a lexed token whose only trivia was whitespace (which is recorded in `SourceInfo.whitespaceRuns` rather than kept as tokens).
 * Shared by every such token, so it's frozen: assign a new array instead of pushing into it.
 *
 * It also marks the token as owning the whitespace run that ends at its start, which is what lets `util.getLeadingWhitespace()` tell a lexed token
 * apart from a synthetic one that just borrowed its position
 */
export const WhitespaceOnlyTrivia: Token[] = Object.freeze([]) as unknown as Token[];

/**
 * The runtime shape of tokens made by the lexer, `util.cloneToken()` and the creators. A class (rather than an object literal)
 * so the deprecated `location`/`range` accessors live once on the prototype instead of on every token
 */
export class TokenObject implements Token {
    constructor(
        public kind: TokenKind,
        public text: string,
        isReserved: boolean,
        public startPosition: number,
        public endPosition: number,
        public sourceInfo: SourceInfo | undefined,
        public leadingTrivia: Token[] | undefined
    ) { }

    /**
     * Derived from `kind` rather than stored, which saves a field on every token. Assigning it does nothing
     */
    public get isReserved(): boolean {
        return ReservedTokenKinds.has(this.kind);
    }

    public set isReserved(value: boolean) { }

    /**
     * Where the token was found. Assigning it moves the token to that location (see `util.assignLocation()`).
     * @deprecated use `util.getLocation(token)`. This is computed on every read
     */
    public get location(): Location | undefined {
        return util.getLocation(this);
    }

    public set location(value: Location | undefined) {
        util.assignLocation(this, value, this.sourceInfo);
    }

    /**
     * @deprecated use `util.getLocation(token)?.range`. This is computed on every read
     */
    public get range(): Range | undefined {
        return util.getLocation(this)?.range;
    }
}
