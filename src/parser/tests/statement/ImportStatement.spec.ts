import { expect } from '../../../chai-config.spec';

import { Parser, ParseMode } from '../../Parser';
import { Lexer } from '../../../lexer/Lexer';
import type { ImportStatement } from '../../Statement';
import { TypeStatement } from '../../Statement';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { isImportStatement } from '../../../astUtils/reflection';
import { expectDiagnostics, expectZeroDiagnostics } from '../../../testHelpers.spec';

describe('parser import statements', () => {
    function parse(text: string) {
        const { tokens } = Lexer.scan(text);
        return Parser.parse(tokens, { mode: ParseMode.BrighterScript });
    }

    it('parses a regular import statement', () => {
        const parser = parse(`
            import "pkg:/source/lib.bs"
        `);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ImportStatement;
        expect(isImportStatement(statement)).to.be.true;
        expect(statement.filePath).to.eql('pkg:/source/lib.bs');
        expect(statement.isTypeOnly).to.be.false;
        expect(statement.tokens.type).to.be.undefined;
    });

    it('parses a type-only import statement', () => {
        const parser = parse(`
            import type "pkg:/source/lib.bs"
        `);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ImportStatement;
        expect(isImportStatement(statement)).to.be.true;
        expect(statement.filePath).to.eql('pkg:/source/lib.bs');
        expect(statement.isTypeOnly).to.be.true;
        expect(statement.tokens.type.text).to.eql('type');
        //the location spans the whole statement
        expect(statement.location.range.start.character).to.eql(statement.tokens.import.location.range.start.character);
        expect(statement.location.range.end.character).to.eql(statement.tokens.path.location.range.end.character + 1);
    });

    it('flags a type-only import that is missing its path', () => {
        const parser = parse(`
            import type
            sub main()
            end sub
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedStringLiteralAfterKeyword('import')
        ]);
        //the rest of the file still parsed
        expect(parser.ast.statements).to.be.lengthOf(2);
    });

    it('does not consume a `type` alias statement that follows a malformed import', () => {
        const parser = parse(`
            import
            type Name = string
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedStringLiteralAfterKeyword('import')
        ]);
        expect(parser.ast.statements[1]).to.be.instanceOf(TypeStatement);
    });

    it('clones the `type` token', () => {
        const parser = parse(`
            import type "pkg:/source/lib.bs"
        `);
        const statement = parser.ast.statements[0] as ImportStatement;
        const clone = statement.clone();
        expect(clone.isTypeOnly).to.be.true;
        expect(clone.tokens.type).not.to.equal(statement.tokens.type);
        expect(clone.tokens.type.text).to.eql('type');
    });
});
