import type { Token } from '../lexer/Token';
import { TokenKind, AllowedLocalIdentifiers, ReservedWords, DisallowedLocalIdentifiers, AllowedProperties } from '../lexer/TokenKind';
import * as CC from './Chunk';
import type { Diagnostic } from 'vscode-languageserver';
import type { DiagnosticInfo } from '../DiagnosticMessages';
import { DiagnosticMessages } from '../DiagnosticMessages';

/** * Parses `Tokens` into chunks of tokens, excluding conditional compilation directives. */
export class PreprocessorParser {
    public diagnostics: Diagnostic[] = [];

    public tokens: Token[] = [];

    private current = 0;

    /**
     * an array of chunks (conditional compilation directives and the associated BrightScript)
     */
    public chunks: CC.Chunk[] = [];

    /**
     * Parses an array of tokens into an array of "chunks" - conditional compilation directives and their
     * associated BrightScript.
     *
     * @param tokens the array of tokens to parse
     */
    public parse(tokens: Token[]) {
        this.tokens = tokens;
        this.diagnostics = [];
        this.current = 0;

        this.chunks = this.nChunks();
        return this;
    }

    public static parse(tokens: Token[]) {
        return new PreprocessorParser().parse(tokens);
    }

    /**
     * Parses tokens to produce an array containing a variable number of heterogeneous chunks.
     * @returns a heterogeneous array of chunks
     */
    private nChunks(): CC.Chunk[] {
        let chunks: CC.Chunk[] = [];

        while (true) {
            let c = this.hashConst();
            if (c) {
                chunks.push(c);
            }

            let maybeEof = this.eof();
            if (maybeEof) {
                chunks.push(maybeEof);
                break;
            } else if (!c) {
                break;
            }
        }

        return chunks;
    }

    /**
     * Parses tokens to produce a "declaration" chunk if possible, otherwise falls back to `hashIf`.
     * @returns a "declaration" chunk if one is detected, otherwise whatever `hashIf` returns
     */
    private hashConst(): CC.Chunk | undefined {
        if (this.match(TokenKind.HashConst)) {
            let name = this.consume(
                DiagnosticMessages.expectedIdentifierAfterKeyword('#const'),
                TokenKind.Identifier,
                //look for any alphanumeric token, we will throw out the bad ones in the next check
                ...AllowedLocalIdentifiers,
                ...AllowedProperties,
                ...DisallowedLocalIdentifiers
            );

            //disallow using keywords for const names
            if (ReservedWords.has(name.text.toLowerCase())) {
                this.diagnostics.push({
                    ...DiagnosticMessages.constNameCannotBeReservedWord(),
                    range: name.range
                });
            }

            this.consume(
                DiagnosticMessages.expectedEqualAfterConstName(),
                TokenKind.Equal
            );
            let value = this.advance();
            //consume trailing newlines
            while (this.match(TokenKind.Newline)) { }
            return new CC.DeclarationChunk(name, value);
        }

        return this.hashIf();
    }

    /**
     * Parses tokens to produce an "if" chunk (including "else if" and "else" chunks) if possible,
     * otherwise falls back to `hashError`.
     * @returns an "if" chunk if one is detected, otherwise whatever `hashError` returns
     */
    private hashIf(): CC.Chunk | undefined {
        if (this.match(TokenKind.HashIf)) {
            let startingLine = this.previous().range.start.line;
            let elseChunk: CC.Chunk[] | undefined;

            let ifCondition = this.advance();
            this.match(TokenKind.Newline);

            let thenChunk = this.nChunks();

            let elseIfs: CC.HashElseIfStatement[] = [];

            while (this.match(TokenKind.HashElseIf)) {
                let condition = this.advance();
                this.match(TokenKind.Newline);

                elseIfs.push({
                    condition: condition,
                    thenChunks: this.nChunks()
                });
            }

            if (this.match(TokenKind.HashElse)) {
                this.match(TokenKind.Newline);

                elseChunk = this.nChunks();
            }

            this.consume(
                DiagnosticMessages.expectedHashElseIfToCloseHashIf(startingLine),
                TokenKind.HashEndIf
            );
            this.match(TokenKind.Newline);

            return new CC.HashIfStatement(ifCondition, thenChunk, elseIfs, elseChunk);
        }

        return this.hashError();
    }

    /**
     * Parses tokens to produce an "error" chunk (including the associated message) if possible,
     * otherwise falls back to a chunk of plain BrightScript.
     * @returns an "error" chunk if one is detected, otherwise whatever `brightScriptChunk` returns
     */
    private hashError(): CC.Chunk | undefined {
        if (this.check(TokenKind.HashError)) {
            let hashErr = this.advance();
            let message = this.advance();
            return new CC.ErrorChunk(hashErr, message);
        }

        return this.brightScriptChunk();
    }

    /**
     * Parses tokens to produce a chunk of BrightScript.
     * @returns a chunk of plain BrightScript if any is detected, otherwise `undefined` to indicate
     *          that no non-conditional compilation directives were found.
     */
    private brightScriptChunk(): CC.BrightScriptChunk | undefined {
        let chunkTokens: Token[] = [];
        while (
            !this.check(
                TokenKind.HashIf,
                TokenKind.HashElseIf,
                TokenKind.HashElse,
                TokenKind.HashEndIf,
                TokenKind.HashConst,
                TokenKind.HashError
            )
        ) {
            let token = this.advance();
            if (token) {
                chunkTokens.push(token);
            }

            if (this.isAtEnd()) {
                break;
            }
        }

        if (chunkTokens.length > 0) {
            return new CC.BrightScriptChunk(chunkTokens);
        } else {
            return undefined;
        }
    }

    private eof(): CC.BrightScriptChunk | undefined {
        if (this.isAtEnd()) {
            return new CC.BrightScriptChunk([this.peek()]);
        } else {
            return undefined;
        }
    }

    /**
     * If the next token is any of the provided tokenKinds, advance and return true.
     * Otherwise return false
     */
    private match(...tokenKinds: TokenKind[]) {
        for (let tokenKind of tokenKinds) {
            if (this.check(tokenKind)) {
                this.advance();
                return true;
            }
        }

        return false;
    }

    private consume(diagnosticInfo: DiagnosticInfo, ...tokenKinds: TokenKind[]): Token {
        let foundTokenKind = tokenKinds
            .map(tokenKind => this.peek().kind === tokenKind)
            .reduce((foundAny, foundCurrent) => foundAny || foundCurrent, false);

        if (foundTokenKind) {
            return this.advance();
        } else {
            this.diagnostics.push({
                ...diagnosticInfo,
                range: this.peek().range
            });
            throw new Error(this.diagnostics[this.diagnostics.length - 1].message);
        }
    }

    private advance(): Token {
        if (!this.isAtEnd()) {
            this.current++;
        }
        return this.previous();
    }

    private check(...tokenKinds: TokenKind[]) {
        if (this.isAtEnd()) {
            return false;
        }

        return tokenKinds.some(tokenKind => this.peek().kind === tokenKind);
    }

    private isAtEnd() {
        return this.peek().kind === TokenKind.Eof;
    }

    private peek() {
        return this.tokens[this.current];
    }

    private previous() {
        return this.tokens[this.current - 1];
    }
}
