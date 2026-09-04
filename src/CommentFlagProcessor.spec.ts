import { expect } from './chai-config.spec';
import { Range } from 'vscode-languageserver';
import { CommentFlagProcessor } from './CommentFlagProcessor';
import { Lexer } from './lexer/Lexer';
import type { BscFile } from '.';
import util from './util';

describe('CommentFlagProcessor', () => {
    let processor: CommentFlagProcessor;

    const mockBscFile: BscFile = null as any;

    describe('tokenizeByWhitespace', () => {
        beforeEach(() => {
            processor = new CommentFlagProcessor(mockBscFile);
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
            processor = new CommentFlagProcessor(mockBscFile, [`'`]);
        });

        it('skips non disable comments', () => {
            expect(
                processor['tokenize'](`'not disable comment`, null as any as Range)
            ).not.to.exist;
        });

        it('tokenizes bs:disable-line comment', () => {
            expect(
                processor['tokenize'](`'bs:disable-line`, null as any as Range)
            ).to.eql({
                commentTokenText: `'`,
                directive: 'line',
                codes: []
            });
        });

        it('tokenizes bs:disable comment as a block directive', () => {
            expect(
                processor['tokenize'](`'bs:disable`, Range.create(0, 0, 0, 11))
            ).to.eql({
                commentTokenText: `'`,
                directive: 'disable',
                codes: []
            });
        });

        it('tokenizes bs:enable comment as a block directive', () => {
            expect(
                processor['tokenize'](`'bs:enable`, Range.create(0, 0, 0, 10))
            ).to.eql({
                commentTokenText: `'`,
                directive: 'enable',
                codes: []
            });
        });

        it('prefers the longer prefix so bs:disable-line is not parsed as bs:disable', () => {
            expect(
                processor['tokenize'](`'bs:disable-line`, Range.create(0, 0, 0, 16))
            ).to.eql({
                commentTokenText: `'`,
                directive: 'line',
                codes: []
            });
        });

        it('tokenizes bs:disable comment with codes', () => {
            const token = Lexer.scan(`'bs:disable:1 2 3`).tokens[0];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                directive: 'disable',
                codes: [{
                    code: '1',
                    range: Range.create(0, 12, 0, 13)
                }, {
                    code: '2',
                    range: Range.create(0, 14, 0, 15)
                }, {
                    code: '3',
                    range: Range.create(0, 16, 0, 17)
                }]
            });
        });

        it('works for special case', () => {
            const token = Lexer.scan(`print "hi" 'bs:disable-line: 123456 999999   aaaab`).tokens[2];
            expect(
                processor['tokenize'](token.text, token.range)
            ).to.eql({
                commentTokenText: `'`,
                directive: 'line',
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
                directive: 'line',
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
                directive: 'line',
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
                directive: 'line',
                codes: [{
                    code: '1',
                    range: Range.create(0, 18, 0, 19)
                }]
            });
        });
    });

    describe('tryAdd + finalize', () => {
        beforeEach(() => {
            //seed the known-codes list so numeric codes used in the tests are accepted
            processor = new CommentFlagProcessor(mockBscFile, [`'`], [1001, 1002]);
        });

        it('supports non-numeric codes on line directives', () => {
            const fresh = new CommentFlagProcessor(mockBscFile, [`'`]);
            fresh.tryAdd(`'bs:disable-line lint123 LINT2 some-textual-diagnostic`, Range.create(0, 0, 0, 54));
            fresh.finalize();
            expect(
                fresh.commentFlags.flatMap(flag => flag.codes)
            ).to.eql([
                'lint123',
                'lint2',
                'some-textual-diagnostic'
            ]);
        });

        it('a bare bs:disable with no closing bs:enable suppresses the rest of the file', () => {
            processor.tryAdd(`'bs:disable`, Range.create(0, 0, 0, 11));
            processor.finalize();

            const blockFlag = processor.commentFlags.find(flag => flag.codes === null && flag.affectedRange.end.line === Number.MAX_SAFE_INTEGER);
            expect(blockFlag).to.exist;
            expect(blockFlag.enableCodes).to.be.undefined;
            expect(blockFlag.affectedRange).to.deep.equal(util.createRange(1, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
        });

        it('a bs:disable / bs:enable pair only suppresses lines between the two', () => {
            processor.tryAdd(`'bs:disable`, Range.create(2, 0, 2, 11));
            processor.tryAdd(`'bs:enable`, Range.create(5, 0, 5, 10));
            processor.finalize();

            const blockFlag = processor.commentFlags.find(flag => flag.codes === null && flag.affectedRange.end.line < Number.MAX_SAFE_INTEGER);
            expect(blockFlag).to.exist;
            expect(blockFlag.affectedRange).to.deep.equal(util.createRange(3, 0, 4, Number.MAX_SAFE_INTEGER));
            expect(blockFlag.enableCodes).to.be.undefined;
        });

        it('bs:enable: <code> after a bare bs:disable carves out an exception via enableCodes', () => {
            //         line 0: bs:disable
            //         line 5: bs:enable: 1001
            processor.tryAdd(`'bs:disable`, Range.create(0, 0, 0, 11));
            processor.tryAdd(`'bs:enable: 1001`, Range.create(5, 0, 5, 16));
            processor.finalize();

            //first block flag (lines 1-4): all disabled, no carveouts
            const firstBlock = processor.commentFlags.find(flag => flag.codes === null &&
                flag.affectedRange.start.line === 1 &&
                flag.affectedRange.end.line === 4
            );
            expect(firstBlock, 'first block flag').to.exist;
            expect(firstBlock.enableCodes).to.be.undefined;

            //second block flag (lines 6-EOF): all disabled except 1001
            const secondBlock = processor.commentFlags.find(flag => flag.codes === null &&
                flag.affectedRange.start.line === 6
            );
            expect(secondBlock, 'second block flag').to.exist;
            expect(secondBlock.enableCodes).to.eql([1001]);
        });

        it('bs:disable: <code> after a bare bs:enable starts suppressing only that code', () => {
            //         line 0: bs:enable   (no-op state-wise; nothing to suppress yet)
            //         line 3: bs:disable: 1001
            processor.tryAdd(`'bs:enable`, Range.create(0, 0, 0, 10));
            processor.tryAdd(`'bs:disable: 1001`, Range.create(3, 0, 3, 17));
            processor.finalize();

            //the bare bs:enable produces no flag (nothing is suppressed in lines 1-2)
            const beforeDisable = processor.commentFlags.find(flag => flag.affectedRange.start.line === 1 && flag.affectedRange.end.line === 2
            );
            expect(beforeDisable, 'no flag emitted while nothing is suppressed').to.be.undefined;

            //the disable: 1001 produces a flag covering lines 4-EOF
            const afterDisable = processor.commentFlags.find(flag => Array.isArray(flag.codes) && flag.codes.length === 1 && flag.codes[0] === 1001
            );
            expect(afterDisable, 'disable: 1001 flag').to.exist;
            expect(afterDisable.affectedRange.start.line).to.equal(4);
            expect(afterDisable.enableCodes).to.be.undefined;
        });

        it('bs:disable: <code> while in disable-all mode subtracts the code from the carveouts', () => {
            //         line 0: bs:disable               (disable everything)
            //         line 3: bs:enable: 1001 1002    (carve out 1001, 1002)
            //         line 6: bs:disable: 1001        (re-suppress 1001 by removing it from carveouts)
            processor.tryAdd(`'bs:disable`, Range.create(0, 0, 0, 11));
            processor.tryAdd(`'bs:enable: 1001 1002`, Range.create(3, 0, 3, 21));
            processor.tryAdd(`'bs:disable: 1001`, Range.create(6, 0, 6, 17));
            processor.finalize();

            const finalBlock = processor.commentFlags.find(flag => flag.codes === null && flag.affectedRange.start.line === 7
            );
            expect(finalBlock, 'final block flag').to.exist;
            expect(finalBlock.enableCodes).to.eql([1002]);
        });
    });
});
