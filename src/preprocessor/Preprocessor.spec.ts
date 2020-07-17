import { identifier, token, EOF } from '../parser/tests/Parser.spec';
import { TokenKind } from '../lexer/TokenKind';
import { Preprocessor } from './Preprocessor';
import { BrightScriptChunk, DeclarationChunk, ErrorChunk, HashIfStatement } from './Chunk';
import { expect } from 'chai';
import { createSandbox } from 'sinon';
let sinon = createSandbox();

describe('preprocessor', () => {
    afterEach(() => {
        sinon.restore();
    });
    it('forwards brightscript chunk contents unmodified', () => {
        let unprocessed = [
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            EOF
        ];

        let { processedTokens } = new Preprocessor().filter([new BrightScriptChunk(unprocessed)]);
        expect(processedTokens).to.eql(unprocessed);
    });

    describe('#const', () => {
        it('removes #const declarations from output', () => {
            let { processedTokens } = new Preprocessor().filter([
                new DeclarationChunk(
                    identifier('lorem'),
                    token(TokenKind.False, 'false', BrsBoolean.False)
                )
            ]);
            expect(processedTokens).to.eql([]);
        });

        describe('values', () => {
            it('allows `true`', () => {
                expect(
                    () => new Preprocessor().filter([
                        new DeclarationChunk(
                            identifier('lorem'),
                            token(TokenKind.True, 'true', BrsBoolean.True)
                        )
                    ])
                ).not.to.throw;
            });

            it('allows `false`', () => {
                expect(() => new Preprocessor().filter([
                    new DeclarationChunk(
                        identifier('ipsum'),
                        token(TokenKind.False, 'false', BrsBoolean.False)
                    )
                ])
                ).not.to.throw;
            });

            it('allows identifiers', () => {
                expect(() => new Preprocessor().filter([
                    // 'ipsum' must be defined before it's referenced
                    new DeclarationChunk(
                        identifier('ipsum'),
                        token(TokenKind.False, 'false', BrsBoolean.False)
                    ),
                    new DeclarationChunk(
                        identifier('dolor'),
                        token(TokenKind.True, 'true', BrsBoolean.True)
                    )
                ])
                ).not.to.throw;
            });

            it('disallows strings', () => {
                expect(() => new Preprocessor().filter([
                    new DeclarationChunk(
                        identifier('sit'),
                        token(TokenKind.String, 'good boy!', new BrsString('good boy!'))
                    )
                ])
                ).to.throw;//('#const declarations can only have');
            });

            it('disallows re-declaration of values', () => {
                expect(() => new Preprocessor().filter([
                    new DeclarationChunk(
                        identifier('lorem'),
                        token(TokenKind.False, 'false', BrsBoolean.False)
                    ),
                    new DeclarationChunk(
                        identifier('lorem'),
                        token(TokenKind.True, 'true', BrsBoolean.True)
                    )
                ])
                ).to.throw;
            });
        });
    });

    describe('#error', () => {
        it('throws error when #error directives encountered', () => {
            expect(() => new Preprocessor().filter([
                new ErrorChunk(token(TokenKind.HashError, '#error'), token(TokenKind.HashError, 'I\'m an error message!'))
            ])
            ).to.throw;
        });

        it('doesn\'t throw when branched around', () => {
            expect(() => new Preprocessor().filter([
                new HashIfStatement(
                    token(TokenKind.False, 'false', BrsBoolean.False),
                    [
                        new ErrorChunk(
                            token(TokenKind.HashError, '#error'),
                            token(TokenKind.HashError, 'I\'m an error message!')
                        )
                    ],
                    [] // no else-ifs necessary
                )
            ])
            ).not.to.throw;
        });
    });

    describe('#if', () => {
        let elseChunk;
        let elseIfChunk;
        let ifChunk;

        beforeEach(() => {
            ifChunk = new BrightScriptChunk([]);
            elseIfChunk = new BrightScriptChunk([]);
            elseChunk = new BrightScriptChunk([]);

            sinon.spy(ifChunk, 'accept');
            sinon.spy(elseIfChunk, 'accept');
            sinon.spy(elseChunk, 'accept');
        });

        it('enters #if branch', () => {
            new Preprocessor().filter([
                new HashIfStatement(
                    token(TokenKind.True, 'true', BrsBoolean.True),
                    [ifChunk],
                    [
                        {
                            condition: token(TokenKind.True, 'true', BrsBoolean.True),
                            thenChunks: [elseIfChunk]
                        }
                    ],
                    [elseChunk]
                )
            ]);

            expect(ifChunk.accept.callCount).to.equal(1);
            expect(elseIfChunk.accept.callCount).to.equal(0);
            expect(elseChunk.accept.callCount).to.equal(0);
        });

        it('enters #else if branch', () => {
            new Preprocessor().filter([
                new HashIfStatement(
                    token(TokenKind.False, 'false', BrsBoolean.False),
                    [ifChunk],
                    [
                        {
                            condition: token(TokenKind.True, 'true', BrsBoolean.True),
                            thenChunks: [elseIfChunk]
                        }
                    ],
                    [elseChunk]
                )
            ]);

            expect(ifChunk.accept.callCount).to.equal(0);
            expect(elseIfChunk.accept.callCount).to.equal(1);
            expect(elseChunk.accept.callCount).to.equal(0);
        });

        it('enters #else branch', () => {
            new Preprocessor().filter([
                new HashIfStatement(
                    token(TokenKind.False, 'false', BrsBoolean.False),
                    [ifChunk],
                    [
                        {
                            condition: token(TokenKind.False, 'false', BrsBoolean.False),
                            thenChunks: [elseIfChunk]
                        }
                    ],
                    [elseChunk]
                )
            ]);

            expect(ifChunk.accept.callCount).to.equal(0);
            expect(elseIfChunk.accept.callCount).to.equal(0);
            expect(elseChunk.accept.callCount).to.equal(1);
        });

        it('enters no branches if none pass', () => {
            new Preprocessor().filter([
                new HashIfStatement(
                    token(TokenKind.False, 'false', BrsBoolean.False),
                    [ifChunk],
                    [] // no else-if chunks
                    // NOTE: no 'else" chunk!
                )
            ]);

            expect(ifChunk.accept.callCount).to.equal(0);
            expect(elseIfChunk.accept.callCount).to.equal(0);
            expect(elseChunk.accept.callCount).to.equal(0);
        });

        it('uses #const values to determine truth', () => {
            new Preprocessor().filter([
                new DeclarationChunk(
                    identifier('lorem'),
                    token(TokenKind.True, 'true', BrsBoolean.True)
                ),
                new HashIfStatement(
                    identifier('lorem'),
                    [ifChunk],
                    [] // no else-if chunks
                    // NOTE: no 'else" chunk!
                )
            ]);

            expect(ifChunk.accept.callCount).to.equal(1);
            expect(elseIfChunk.accept.callCount).to.equal(0);
            expect(elseChunk.accept.callCount).to.equal(0);
        });
    });
});
