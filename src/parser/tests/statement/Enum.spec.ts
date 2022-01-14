import { expect } from 'chai';
import { LiteralExpression } from '../../Expression';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectInstanceOf, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { EnumStatement } from '../../Statement';

describe('EnumStatement', () => {
    it('parses empty enum statement', () => {
        const parser = Parser.parse(`
            enum SomeEnum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.ast.statements[0]).to.be.instanceOf(EnumStatement);
    });

    it('supports annotations above', () => {
        const parser = Parser.parse(`
            @someAnnotation
            enum SomeEnum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.ast.statements[0].annotations[0].name).to.eql('someAnnotation');
    });

    it('constructs when missing enum name', () => {
        const parser = Parser.parse(`
            enum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectDiagnostics(parser, [
            DiagnosticMessages.expectedIdentifier()
        ]);
        expect(parser.ast.statements[0]).to.be.instanceOf(EnumStatement);
    });

    it('collects uninitialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up
                down
                left
                right
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(
            (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.tokens.name.text)
        ).to.eql([
            'up',
            'down',
            'left',
            'right'
        ]);
    });

    it('collects int-initialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up = 1
                down = 2
                left = 3
                right = 4
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        const values = (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.value) as LiteralExpression[];
        expectInstanceOf(values, [
            LiteralExpression,
            LiteralExpression,
            LiteralExpression,
            LiteralExpression
        ]);
        expect(values.map(x => x.token.text)).to.eql([
            '1',
            '2',
            '3',
            '4'
        ]);
    });

    it('collects string-initialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up = "u"
                down = "d"
                left = "l"
                right = "r"
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        const values = (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.value) as LiteralExpression[];
        expectInstanceOf(values, [
            LiteralExpression,
            LiteralExpression,
            LiteralExpression,
            LiteralExpression
        ]);
        expect(values.map(x => x.token.text)).to.eql([
            '"u"',
            '"d"',
            '"l"',
            '"r"'
        ]);
    });

    it('flags when used in brs mode', () => {
        const parser = Parser.parse(`
            enum Direction
                up = "u"
                down = "d"
                left = "l"
                right = "r"
            end enum
        `, { mode: ParseMode.BrightScript });
        expectDiagnostics(parser, [
            DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('enum declarations')
        ]);
    });
});
