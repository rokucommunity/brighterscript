import { ClassStatement } from './ClassStatement';
import { ParseMode } from './Parser';
import { expect } from 'chai';
import { Range } from 'vscode-languageserver';
import { NamespacedVariableNameExpression, VariableExpression } from './Expression';

describe('ClassStatement', () => {
    function create(name: string, namespaceName?: string) {
        let stmt = new ClassStatement(
            <any>{ range: Range.create(0, 0, 0, 0) },
            <any>{ text: name },
            null,
            <any>{ range: Range.create(0, 0, 0, 0) },
            null,
            null,
            namespaceName ? new NamespacedVariableNameExpression(new VariableExpression(<any>{ text: namespaceName }, null)) : null
        );
        return stmt;
    }
    describe('getName', () => {
        it('handles null namespace name', () => {
            let stmt = create('Animal');
            expect(stmt.getName(ParseMode.BrightScript)).to.equal('Animal');
            expect(stmt.getName(ParseMode.BrighterScript)).to.equal('Animal');
        });
        it('handles namespaces', () => {
            let stmt = create('Animal', 'NameA');
            expect(stmt.getName(ParseMode.BrightScript)).to.equal('NameA_Animal');
            expect(stmt.getName(ParseMode.BrighterScript)).to.equal('NameA.Animal');
        });
    });
});
