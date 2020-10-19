import { expect } from 'chai';
import type { NamespaceStatement } from './Statement';
import { Body, ClassStatement, CommentStatement, EmptyStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import { CancellationTokenSource, WalkMode } from '../astUtils';
import { Range } from 'vscode-languageserver';
import { NamespacedVariableNameExpression, VariableExpression } from './Expression';

describe('Statement', () => {
    describe('EmptyStatement', () => {
        it('returns empty array for transpile', () => {
            const statement = new EmptyStatement();
            expect(statement.transpile({} as any)).to.eql([]);
        });
        it('does nothing for walkAll', () => {
            const statement = new EmptyStatement();
            statement.walk(() => {
                expect(true).to.be.false;
            }, { walkMode: WalkMode.visitAllRecursive });
        });
    });

    describe('Body', () => {
        it('initializes statements array if none provided', () => {
            const body = new Body();
            expect(body.statements).to.eql([]);
        });
    });

    describe('NamespaceStatement', () => {
        it('getName() works', () => {
            const parser = Parser.parse(`
                namespace NameA.NameB
                end namespace
            `);
            const statement = parser.ast.statements[0] as NamespaceStatement;
            expect(statement.getName(ParseMode.BrighterScript)).to.equal('NameA.NameB');
            expect(statement.getName(ParseMode.BrightScript)).to.equal('NameA_NameB');
        });
    });

    describe('CommentStatement', () => {
        describe('walk', () => {
            it('skips visitor if canceled', () => {
                const comment = new CommentStatement([]);
                const cancel = new CancellationTokenSource();
                cancel.cancel();
                comment.walk(() => {
                    throw new Error('Should not have been called');
                }, { walkMode: WalkMode.visitAllRecursive, cancel: cancel.token });
            });
        });
    });

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

});
