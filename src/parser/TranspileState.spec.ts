import { expect } from '../chai-config.spec';
import { TranspileState } from './TranspileState';
import type { Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { BsConfig } from '../BsConfig';

describe('TranspileState', () => {
    let state: TranspileState;

    beforeEach(() => {
        state = new TranspileState('source/test.bs', {} as BsConfig);
    });

    describe('tokenToSourceNodeWithTrivia', () => {
        describe('token sanitization', () => {
            it('handles tokens with missing leadingTrivia property', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'foo',
                    range: {
                        start: { line: 0, character: 4 },
                        end: { line: 0, character: 7 }
                    }
                    // Note: no leadingTrivia property at all (plugin-contributed token)
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('foo');
            });

            it('handles tokens with undefined leadingTrivia', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 3 }
                    },
                    leadingTrivia: undefined
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('bar');
            });

            it('handles tokens with null leadingTrivia', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'baz',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 3 }
                    },
                    leadingTrivia: null
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('baz');
            });

            it('preserves leadingWhitespace when leadingTrivia is missing', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'test',
                    range: {
                        start: { line: 0, character: 4 },
                        end: { line: 0, character: 8 }
                    },
                    leadingWhitespace: '    ', // 4 spaces
                    leadingTrivia: undefined
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('    test');
            });

            it('preserves leadingWhitespace with single space', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'value',
                    range: {
                        start: { line: 0, character: 1 },
                        end: { line: 0, character: 6 }
                    },
                    leadingWhitespace: ' ',
                    leadingTrivia: []
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal(' value');
            });

            it('handles tokens without range', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'synthetic',
                    leadingTrivia: []
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('synthetic');
            });

            it('handles null token', () => {
                const result = state.tokenToSourceNodeWithTrivia(null as any);
                expect(result.toString()).to.equal('');
            });

            it('handles undefined token', () => {
                const result = state.tokenToSourceNodeWithTrivia(undefined as any);
                expect(result.toString()).to.equal('');
            });
        });

        describe('trivia preservation', () => {
            it('preserves existing leadingTrivia when present', () => {
                const token: Token = {
                    kind: TokenKind.Identifier,
                    text: 'foo',
                    range: {
                        start: { line: 1, character: 4 },
                        end: { line: 1, character: 7 }
                    },
                    leadingTrivia: [
                        {
                            kind: TokenKind.Whitespace,
                            text: '    ',
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: 4 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        }
                    ],
                    isReserved: false
                };

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('    foo');
            });

            it('preserves comments in leadingTrivia', () => {
                const token: Token = {
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    range: {
                        start: { line: 2, character: 0 },
                        end: { line: 2, character: 3 }
                    },
                    leadingTrivia: [
                        {
                            kind: TokenKind.Comment,
                            text: '\'comment',
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: 8 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        },
                        {
                            kind: TokenKind.Newline,
                            text: '\n',
                            range: {
                                start: { line: 1, character: 8 },
                                end: { line: 2, character: 0 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        }
                    ],
                    isReserved: false
                };

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('\'comment\nbar');
            });

            it('handles multiple trivia tokens', () => {
                const token: Token = {
                    kind: TokenKind.Identifier,
                    text: 'test',
                    range: {
                        start: { line: 3, character: 4 },
                        end: { line: 3, character: 8 }
                    },
                    leadingTrivia: [
                        {
                            kind: TokenKind.Newline,
                            text: '\n',
                            range: {
                                start: { line: 2, character: 0 },
                                end: { line: 3, character: 0 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        },
                        {
                            kind: TokenKind.Whitespace,
                            text: '    ',
                            range: {
                                start: { line: 3, character: 0 },
                                end: { line: 3, character: 4 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        }
                    ],
                    isReserved: false
                };

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('\n    test');
            });
        });

        describe('edge cases', () => {
            it('handles token with empty text', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: '',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    },
                    leadingTrivia: []
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('');
            });

            it('prefers leadingTrivia over leadingWhitespace when both exist', () => {
                const token: Token = {
                    kind: TokenKind.Identifier,
                    text: 'value',
                    range: {
                        start: { line: 0, character: 2 },
                        end: { line: 0, character: 7 }
                    },
                    leadingWhitespace: '  ',
                    leadingTrivia: [
                        {
                            kind: TokenKind.Whitespace,
                            text: '  ',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 2 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        }
                    ],
                    isReserved: false
                };

                const result = state.tokenToSourceNodeWithTrivia(token);
                // Should use trivia, not duplicate whitespace
                expect(result.toString()).to.equal('  value');
            });

            it('handles malformed trivia tokens gracefully', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'test',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 4 }
                    },
                    leadingTrivia: [
                        null, // malformed
                        {
                            kind: TokenKind.Whitespace,
                            text: ' ',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 1 }
                            },
                            leadingTrivia: [],
                            isReserved: false
                        },
                        undefined, // malformed
                        {
                            // missing range
                            kind: TokenKind.Comment,
                            text: '\'test',
                            leadingTrivia: [],
                            isReserved: false
                        } as any
                    ]
                } as any;

                // Should handle gracefully without crashing
                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.include('test');
            });
        });

        describe('plugin scenarios', () => {
            it('handles plugin-created token with only text and kind', () => {
                // Minimal plugin-created token
                const token = {
                    kind: TokenKind.Plus,
                    text: '+'
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('+');
            });

            it('handles plugin-created identifier with spacing', () => {
                const token = {
                    kind: TokenKind.Identifier,
                    text: 'pluginVar',
                    leadingWhitespace: ' '
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal(' pluginVar');
            });

            it('handles plugin-created token with partial data', () => {
                const token = {
                    text: 'partial',
                    range: {
                        start: { line: 5, character: 10 },
                        end: { line: 5, character: 17 }
                    }
                } as any;

                const result = state.tokenToSourceNodeWithTrivia(token);
                expect(result.toString()).to.equal('partial');
            });
        });

    });
});
