import { expect } from 'chai';
import type { BrsFile } from '../../files/BrsFile';
import type { AALiteralExpression, DottedGetExpression } from '../../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, PrintStatement } from '../../parser/Statement';
import { Program } from '../../Program';

describe('BrsFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({});
    });

    it('links dotted get expression parents', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print {}.beta.charlie
            end sub
        `);
        program.validate();
        const func = (file.parser.ast.statements[0] as FunctionStatement);
        const print = func.func.body.statements[0] as PrintStatement;
        expect(print.parent).to.equal(func.func.body);

        const charlie = print.expressions[0] as DottedGetExpression;
        expect(charlie.parent).to.equal(print);

        const beta = charlie.obj as DottedGetExpression;
        expect(beta.parent).to.equal(charlie);

        const aaLiteral = beta.obj as AALiteralExpression;
        expect(aaLiteral.parent).to.equal(beta);
    });

    it('links NamespacedVariableNameExpression dotted get parents', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace alpha.bravo
                class Delta extends alpha.bravo.Charlie
                end class
                class Charlie
                end class
            end namespace
        `);
        program.validate();
        const namespace = (file.parser.ast.statements[0] as NamespaceStatement);
        const deltaClass = namespace.body.statements[0] as ClassStatement;
        expect(deltaClass.parent).to.equal(namespace.body);

        const charlie = (deltaClass.parentClassName.expression as DottedGetExpression);
        expect(charlie.parent).to.equal(deltaClass.parentClassName);

        const bravo = charlie.obj as DottedGetExpression;
        expect(bravo.parent).to.equal(charlie);

        const alpha = bravo.obj as DottedGetExpression;
        expect(alpha.parent).to.equal(bravo);
    });
});
