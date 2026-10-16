import { expect } from '../../../chai-config.spec';

import { Parser, ParseMode } from '../../Parser';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import type { ImportStatement } from '../../Statement';
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
        expect(statement.typeImports).to.eql([]);
    });

    it('parses a type-only import with a single name', () => {
        const parser = parse(`
            import type { Alpha } from "pkg:/source/lib.bs"
        `);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ImportStatement;
        expect(statement.isTypeOnly).to.be.true;
        expect(statement.filePath).to.eql('pkg:/source/lib.bs');
        expect(statement.tokens.from.text).to.eql('from');
        expect(statement.typeImports.map(x => [x.name, x.localName])).to.eql([
            ['Alpha', 'Alpha']
        ]);
        //the location spans the whole statement
        expect(statement.location.range.start.character).to.eql(statement.tokens.import.location.range.start.character);
        expect(statement.location.range.end.character).to.eql(statement.tokens.path.location.range.end.character + 1);
    });

    it('parses aliased and namespaced names', () => {
        const parser = parse(`
            import type { Alpha as Beta, Gamma.Delta as Epsilon, Zeta.Eta } from "pkg:/source/lib.bs"
        `);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ImportStatement;
        expect(statement.typeImports.map(x => [x.name, x.localName])).to.eql([
            ['Alpha', 'Beta'],
            ['Gamma.Delta', 'Epsilon'],
            ['Zeta.Eta', 'Eta']
        ]);
        expect(statement.typeImports[1].tokens.nameParts.map(x => x.text)).to.eql(['Gamma', 'Delta']);
        expect(statement.typeImports[1].tokens.as.text).to.eql('as');
        expect(statement.typeImports[1].tokens.alias.text).to.eql('Epsilon');
        expect(statement.typeImports[2].tokens.alias).to.be.undefined;
    });

    it('is case insensitive for keywords', () => {
        const parser = parse(`
            IMPORT TYPE { Alpha AS Beta } FROM "pkg:/source/lib.bs"
        `);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as ImportStatement;
        expect(statement.isTypeOnly).to.be.true;
        expect(statement.tokens.type.text).to.eql('TYPE');
        expect(statement.tokens.from.text).to.eql('FROM');
        expect(statement.typeImports.map(x => [x.name, x.localName])).to.eql([
            ['Alpha', 'Beta']
        ]);
    });

    it('flags a missing `from`', () => {
        const parser = parse(`
            import type { Alpha } "pkg:/source/lib.bs"
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedToken('from')
        ]);
        //the path was still captured
        expect((parser.ast.statements[0] as ImportStatement).filePath).to.eql('pkg:/source/lib.bs');
    });

    it('flags a missing path', () => {
        const parser = parse(`
            import type { Alpha } from
            sub main()
            end sub
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedStringLiteralAfterKeyword('from')
        ]);
        //the rest of the file still parsed
        expect(parser.ast.statements).to.be.lengthOf(2);
    });

    it('flags empty braces', () => {
        const parser = parse(`
            import type { } from "pkg:/source/lib.bs"
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedIdentifier('{')
        ]);
    });

    it('does not support importing a whole file as a type', () => {
        const parser = parse(`
            import type "pkg:/source/lib.bs"
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedToken(TokenKind.LeftCurlyBrace),
            DiagnosticMessages.expectedToken(TokenKind.RightCurlyBrace),
            DiagnosticMessages.expectedToken('from')
        ]);
    });

    it('clones every token', () => {
        const parser = parse(`
            import type { Alpha as Beta, Gamma } from "pkg:/source/lib.bs"
        `);
        const statement = parser.ast.statements[0] as ImportStatement;
        const clone = statement.clone();
        expect(clone.isTypeOnly).to.be.true;
        expect(clone.tokens.type).not.to.equal(statement.tokens.type);
        expect(clone.typeImports.map(x => [x.name, x.localName])).to.eql([
            ['Alpha', 'Beta'],
            ['Gamma', 'Gamma']
        ]);
        expect(clone.typeImports[0].tokens.alias).not.to.equal(statement.typeImports[0].tokens.alias);
        expect(clone.typeImports[0].tokens.alias.text).to.eql('Beta');
    });
});
