import { createToken } from '../../astUtils/creators';
import { TokenKind } from '../../lexer/TokenKind';
import { testParse } from './tests/BsParserTestUtils.spec';

describe('BsParser', () => {
    it('creates empty body on empty program', () => {
        testParse('', []);
    });

    it('captures whitespace at the root of body', () => {
        testParse([' \n\t\r\n'], [
            ' ',
            '\n',
            '\t',
            '\r\n'
        ]);
    });

    it('captures comments', () => {
        testParse([
            '\n',
            `\t'comment\n`,
            ' \n'
        ], [
            '\n',
            '\t',
            createToken(TokenKind.Comment, `'comment`),
            '\n',
            ' ',
            '\n'
        ]);
    });
});
