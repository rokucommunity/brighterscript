import { expect } from 'chai';
import { Body, CommentStatement, EmptyStatement, NamespaceStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import { CancellationTokenSource } from '../astUtils';

describe('Statement', () => {
    describe('EmptyStatement', () => {
        it('returns empty array for transpile', () => {
            const statement = new EmptyStatement();
            expect(statement.transpile({} as any)).to.eql([]);
        });
        it('does nothing for walkAll', () => {
            const statement = new EmptyStatement();
            statement.walkAll(() => {
                expect(true).to.be.false;
            });
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
                }, null, cancel.token);
            });
        });
    });
});
