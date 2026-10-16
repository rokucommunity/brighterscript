import type { Location, Range } from 'vscode-languageserver';
import type { SourceInfo, Token } from './Token';
import type { TokenKind } from './TokenKind';
import util from '../util';

/**
 * The runtime shape of tokens made by the lexer, `util.cloneToken()` and the creators. A class (rather than an object literal)
 * so the deprecated `location`/`range` accessors live once on the prototype instead of on every token
 */
export class TokenObject implements Token {
    constructor(
        public kind: TokenKind,
        public text: string,
        public isReserved: boolean,
        public startPosition: number,
        public endPosition: number,
        public sourceInfo: SourceInfo | undefined,
        public leadingTrivia: Token[] | undefined
    ) { }

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
