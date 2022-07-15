import { DiagnosticMessages } from '../../../../DiagnosticMessages';
import { TokenKind } from '../../../../lexer/TokenKind';
import { Node, NodeType, ParseMode } from '../../BsParser';
import { testParse } from '../BsParserTestUtils.spec';

describe.only('ImportStatement', () => {

    it('parses without errors', () => {
        testParse(`
            import "somePath"
        `, [
            new Node(NodeType.ImportStatement, [
                { kind: TokenKind.Import, text: 'import' },
                { kind: TokenKind.Whitespace, text: ' ' },
                { kind: TokenKind.StringLiteral, text: '"somePath"' }
            ])
        ]);
    });

    it('catches import statements used in brightscript files', () => {
        testParse(`
            import "somePath"
        `, [
            new Node(NodeType.ImportStatement, [
                { kind: TokenKind.Import, text: 'import' },
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('import statements'),
                { kind: TokenKind.Whitespace, text: ' ' },
                { kind: TokenKind.StringLiteral, text: '"somePath"' }
            ])
        ], { mode: ParseMode.BrightScript });
    });

    it('catches missing file path', () => {
        testParse(`
            import
        `, [
            'import',
            DiagnosticMessages.expectedStringLiteralAfterKeyword('import')
        ]);
    });
});
