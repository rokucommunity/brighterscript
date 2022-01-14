import { expect } from 'chai';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { EnumStatement } from '../../Statement';

describe.only('EnumStatement', () => {
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

    it('still constructs without a name', () => {
        const parser = Parser.parse(`
            enum SomeEnum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expect(parser.ast.statements[0]).to.be.instanceOf(EnumStatement);
    });
});
