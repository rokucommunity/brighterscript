import { expect } from 'chai';
import { Range } from 'vscode-languageserver';
import { CommentFlagProcessor } from './CommentFlagProcessor';
import { Lexer } from './lexer/Lexer';

describe('CommentFlagProcessor', () => {
    let processor: CommentFlagProcessor;

    describe('tokenizeByWhitespace', () => {
        beforeEach(() => {
            processor = new CommentFlagProcessor(null);
        });

        it('works with single chars', () => {
            expect(processor['tokenizeByWhitespace']('a b c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 4,
                text: 'c'
            }]);
        });

        it('works with tabs', () => {
            expect(processor['tokenizeByWhitespace']('a\tb\t c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 5,
                text: 'c'
            }]);

            it('works with leading whitespace', () => {
                expect(processor['tokenizeByWhitespace']('  \ta\tb\t c')).to.deep.equal([{
                    startIndex: 4,
                    text: 'a'
                }, {
                    startIndex: 6,
                    text: 'b'
                },
                {
                    startIndex: 9,
                    text: 'c'
                }]);
            });

            it('works with multiple characters in a word', () => {
                expect(processor['tokenizeByWhitespace']('abc 123')).to.deep.equal([{
                    startIndex: 0,
                    text: 'abc'
                }, {
                    startIndex: 4,
                    text: '123'
                }]);
            });
        });
    });

    describe('tokenize', () => {
        beforeEach(() => {
            processor = new CommentFlagProcessor(null, [`'`]);
        });

        it('skips non disable comments', () => {
            expect(
                processor['tokenize'](`'not disable comment`, null)
            ).not.to.exist;
        });

        it('tokenizes bs:disable-line comment', () => {
            expect(
                processor['tokenize'](`'bs:disable-line`, null)
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: []
            });
        });

        it('works for special case', () => {
            const token = Lexer.scan(`print "hi" 'bs:disable-line: 123456 999999   aaaab`).tokens[2];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '123456',
                    range: Range.create(0, 29, 0, 35)
                }, {
                    code: '999999',
                    range: Range.create(0, 36, 0, 42)
                }, {
                    code: 'aaaab',
                    range: Range.create(0, 45, 0, 50)
                }]
            });
        });

        it('tokenizes bs:disable-line comment with codes', () => {
            const token = Lexer.scan(`'bs:disable-line:1 2 3`).tokens[0];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '1',
                    range: Range.create(0, 17, 0, 18)
                }, {
                    code: '2',
                    range: Range.create(0, 19, 0, 20)
                }, {
                    code: '3',
                    range: Range.create(0, 21, 0, 22)
                }]
            });
        });

        it('tokenizes bs:disable-line comment with leading space', () => {
            const token = Lexer.scan(`' bs:disable-line:1`).tokens[0];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '1',
                    range: Range.create(0, 18, 0, 19)
                }]
            });
        });

        it('tokenizes bs:disable-line comment with leading tab', () => {
            const token = Lexer.scan(`'\tbs:disable-line:1`).tokens[0];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                disableType: 'line',
                codes: [{
                    code: '1',
                    range: Range.create(0, 18, 0, 19)
                }]
            });
        });
    });
});
