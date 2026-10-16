import { expect } from '../../../chai-config.spec';
import { ParseMode, Parser } from '../../Parser';
import type { DottedSetStatement, ExpressionStatement, IncrementStatement, IndexedSetStatement } from '../../Statement';
import { WithStatement } from '../../Statement';
import type { CallExpression, DottedGetExpression, FunctionExpression, IndexedGetExpression } from '../../Expression';
import { WithContextExpression } from '../../Expression';
import { isFunctionExpression, isWithContextExpression, isWithStatement } from '../../../astUtils/reflection';
import { expectDiagnostics, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { util } from '../../../util';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { WalkMode } from '../../../astUtils/visitors';

describe('parser with statement', () => {
    /**
     * Parse `text` as the body of a function and return the parser plus the statements of that body
     */
    function parseBody(text: string, mode = ParseMode.BrighterScript) {
        const parser = Parser.parse(`
            sub main(target)
                ${text}
            end sub
        `, { mode: mode });
        const func = parser.ast.findChild<FunctionExpression>(isFunctionExpression);
        return { parser: parser, statements: func.body.statements };
    }

    it('parses a with block', () => {
        const { parser, statements } = parseBody(`
            with target
                .name = "Coho Vineyard"
                .url = "http://www.cohovineyard.com/"
            end with
        `);
        expectZeroDiagnostics(parser);
        expect(statements).to.be.lengthOf(1);
        const stmt = statements[0] as WithStatement;
        expect(stmt).to.be.instanceof(WithStatement);
        expect(stmt.tokens.with.text).to.eql('with');
        expect(stmt.tokens.endWith.text).to.eql('end with');
        expect(stmt.expression.kind).to.eql('VariableExpression');
        expect(stmt.body.statements).to.be.lengthOf(2);
    });

    it('parses a leading-dot assignment as a DottedSetStatement on the with context', () => {
        const { parser, statements } = parseBody(`
            with target
                .name = "x"
            end with
        `);
        expectZeroDiagnostics(parser);
        const set = (statements[0] as WithStatement).body.statements[0] as DottedSetStatement;
        expect(set.kind).to.eql('DottedSetStatement');
        expect(set.tokens.name.text).to.eql('name');
        expect(set.obj).to.be.instanceof(WithContextExpression);
    });

    it('supports leading-dot members anywhere an expression is allowed', () => {
        const { parser, statements } = parseBody(`
            with target
                .save()
                .count++
                .total += 5
                .full = .first + .last
                .send(.email, .name)
                .isAdmin = not .isGuest
                .item = .items[0]
                .nested = .child.grandchild
                .result = .lookup("key").value
            end with
        `);
        expectZeroDiagnostics(parser);
        const body = (statements[0] as WithStatement).body.statements;
        expect(body).to.be.lengthOf(9);

        //.save()
        const call = (body[0] as ExpressionStatement).expression as CallExpression;
        expect(call.kind).to.eql('CallExpression');
        expect((call.callee as DottedGetExpression).obj).to.be.instanceof(WithContextExpression);

        //.count++
        const increment = body[1] as IncrementStatement;
        expect(increment.kind).to.eql('IncrementStatement');
        expect(((increment.value as DottedGetExpression).obj)).to.be.instanceof(WithContextExpression);

        //.total += 5
        expect(body[2].kind).to.eql('AugmentedAssignmentStatement');

        //.send(.email, .name)
        const send = (body[4] as ExpressionStatement).expression as CallExpression;
        expect(((send.args[0] as DottedGetExpression).obj)).to.be.instanceof(WithContextExpression);

        //.item = .items[0]
        const indexed = (body[6] as DottedSetStatement).value as IndexedGetExpression;
        expect(indexed.kind).to.eql('IndexedGetExpression');
        expect(((indexed.obj as DottedGetExpression).obj)).to.be.instanceof(WithContextExpression);

        //every with context in the block resolves to this with statement
        const contexts = statements[0].findChildren<WithContextExpression>(isWithContextExpression, { walkMode: WalkMode.visitAllRecursive });
        expect(contexts.length).to.be.greaterThan(10);
        for (const context of contexts) {
            expect(context.getWithStatement()).to.equal(statements[0]);
        }
    });

    it('supports indexing the target with a leading `.[`', () => {
        const { parser, statements } = parseBody(`
            with target
                .[0] = "First slot"
                .[1] = .[0]
            end with
        `);
        expectZeroDiagnostics(parser);
        const body = (statements[0] as WithStatement).body.statements;
        expect(body).to.be.lengthOf(2);

        //.[0] = "First slot"
        const set = body[0] as IndexedSetStatement;
        expect(set.kind).to.eql('IndexedSetStatement');
        expect(set.obj).to.be.instanceof(WithContextExpression);
        expect(set.indexes).to.be.lengthOf(1);

        //.[1] = .[0]
        const get = (body[1] as IndexedSetStatement).value as IndexedGetExpression;
        expect(get.kind).to.eql('IndexedGetExpression');
        expect(get.obj).to.be.instanceof(WithContextExpression);
    });

    it('supports nested with blocks, where the inner target can reference the outer block', () => {
        const { parser, statements } = parseBody(`
            with target
                .id = 1
                with .customer
                    .name = "Ann"
                end with
                .total = 2
            end with
        `);
        expectZeroDiagnostics(parser);
        const outer = statements[0] as WithStatement;
        expect(outer.body.statements).to.be.lengthOf(3);
        const inner = outer.body.statements[1] as WithStatement;
        expect(inner).to.be.instanceof(WithStatement);

        //`with .customer` refers to the OUTER block
        const innerTarget = inner.expression as DottedGetExpression;
        expect(innerTarget.tokens.name.text).to.eql('customer');
        expect((innerTarget.obj as WithContextExpression).getWithStatement()).to.equal(outer);

        //`.name` inside the inner block refers to the INNER block
        const innerSet = inner.body.statements[0] as DottedSetStatement;
        expect((innerSet.obj as WithContextExpression).getWithStatement()).to.equal(inner);

        //`.total` after the inner block refers to the outer block again
        const outerSet = outer.body.statements[2] as DottedSetStatement;
        expect((outerSet.obj as WithContextExpression).getWithStatement()).to.equal(outer);

        //a plain variable target is used as-is; anything else is evaluated into a local, numbered by how many
        //enclosing blocks also needed one
        expect(outer.usesTempVariable()).to.be.false;
        expect(inner.usesTempVariable()).to.be.true;
        expect(inner.getTempVariableName()).to.eql('__bsc_tmp_with0');
    });

    it('flags a leading-dot member inside a function nested in the with block', () => {
        const { parser, statements } = parseBody(`
            with target
                .callback = function()
                    return .name
                end function
                .name = "x"
            end with
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.withMemberInNestedFunction('name')
        ]);
        //the with statement itself and its own members survive
        const contexts = statements[0].findChildren<WithContextExpression>(isWithContextExpression, { walkMode: WalkMode.visitAllRecursive });
        expect(contexts).to.be.lengthOf(2);
        for (const context of contexts) {
            expect(context.getWithStatement()).to.equal(statements[0]);
        }
    });

    it('flags a leading-dot member outside a with block', () => {
        const { parser, statements } = parseBody(`
            .name = "x"
            print .other
            print 1
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.withMemberOutsideWithBlock('name'),
            DiagnosticMessages.withMemberOutsideWithBlock('other')
        ]);
        //the bad lines are discarded and parsing continues
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].kind).to.eql('PrintStatement');
    });

    it('reports a leading dot as an unexpected token in BrightScript files', () => {
        const { parser } = parseBody(`
            .name = "x"
        `, ParseMode.BrightScript);
        expectDiagnostics(parser, [
            DiagnosticMessages.unexpectedToken('.')
        ]);
    });

    it('supports the single-line colon form', () => {
        const { parser, statements } = parseBody(`
            with target: .a = 1: .b = 2: end with
        `);
        expectZeroDiagnostics(parser);
        expect(statements).to.be.lengthOf(1);
        expect((statements[0] as WithStatement).body.statements).to.be.lengthOf(2);
    });

    it('accepts `endwith` as the terminator', () => {
        const { parser, statements } = parseBody(`
            with target
                .a = 1
            endwith
        `);
        expectZeroDiagnostics(parser);
        expect((statements[0] as WithStatement).tokens.endWith.text).to.eql('endwith');
    });

    it('accepts complex target expressions', () => {
        const { parser, statements } = parseBody(`
            with getThing(1, 2).child
                .a = 1
            end with
            with (target ?? fallback)
                .a = 1
            end with
            with [1, 2]
                .push(3)
            end with
            with m.top.findNode("label")
                .text = "hi"
            end with
        `);
        expectZeroDiagnostics(parser);
        expect(statements).to.be.lengthOf(4);
        expect(statements.every(isWithStatement)).to.be.true;
        expect((statements[1] as WithStatement).expression.kind).to.eql('GroupingExpression');
        expect((statements[2] as WithStatement).expression.kind).to.eql('ArrayLiteralExpression');
        //none of these are plain variables, so each needs a local
        expect((statements as WithStatement[]).every(x => x.usesTempVariable())).to.be.true;
    });

    it('flags a missing `end with`', () => {
        const { parser } = parseBody(`
            with target
                .a = 1
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.couldNotFindMatchingEndKeyword('with')
        ]);
    });

    it('flags a `with` without a target expression', () => {
        const { parser, statements } = parseBody(`
            with
                .a = 1
            end with
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedExpressionAfterWith()
        ]);
        //still produces the statement so the rest of the file parses
        expect(statements[0]).to.be.instanceof(WithStatement);
    });

    it('flags `with` in BrightScript files', () => {
        const { parser } = parseBody(`
            with target
                .a = 1
            end with
        `, ParseMode.BrightScript);
        expectDiagnostics(parser, [
            DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('with statement')
        ]);
    });

    describe('`with` as an identifier', () => {
        it('still allows `with` as a variable, property and function name', () => {
            for (const mode of [ParseMode.BrightScript, ParseMode.BrighterScript]) {
                const { parser, statements } = parseBody(`
                    with = {}
                    with.foo = 1
                    with["bar"] = 2
                    with += 1
                    with++
                    print with
                    print with.foo
                    x = with
                    y = with(1)
                    z = target.with
                    for each with in [1]
                    end for
                `, mode);
                expectZeroDiagnostics(parser);
                expect(statements.some(isWithStatement)).to.be.false;
                expect(statements[0].kind).to.eql('AssignmentStatement');
                expect(statements[1].kind).to.eql('DottedSetStatement');
                expect(statements[2].kind).to.eql('IndexedSetStatement');
            }
        });

        it('uses the whitespace after `with` to tell a block from a variable', () => {
            const { parser, statements } = parseBody(`
                with.a = 1
                with target
                    with .a
                    end with
                end with
                with(1)
                with (1)
                end with
                with[0] = 1
                with [1]
                end with
            `);
            expectZeroDiagnostics(parser);
            expect(statements.map(x => x.kind)).to.eql([
                'DottedSetStatement',
                'WithStatement',
                'ExpressionStatement',
                'WithStatement',
                'IndexedSetStatement',
                'WithStatement'
            ]);
            //`with .a` is a nested block whose target is `.a` of the outer block
            const inner = (statements[1] as WithStatement).body.statements[0] as WithStatement;
            expect(inner).to.be.instanceof(WithStatement);
            expect((inner.expression as DottedGetExpression).obj).to.be.instanceof(WithContextExpression);
        });
    });

    describe('statements allowed in the body', () => {
        it('flags anything that is not a leading-dot statement or a nested with block', () => {
            const { parser, statements } = parseBody(`
                with target
                    .text = "Hello"
                    print .text
                    runFunction()
                    name = .name
                    if .isAdmin then .role = "admin"
                    for each item in .items
                    end for
                    goto done
                    done:
                    with .child
                        .name = "Ann"
                        print .name
                    end with
                    .setFocus(true)
                end with
            `);
            expectDiagnostics(parser, [
                DiagnosticMessages.unexpectedToken('print'),
                DiagnosticMessages.unexpectedToken('runFunction'),
                DiagnosticMessages.unexpectedToken('name'),
                DiagnosticMessages.unexpectedToken('if'),
                DiagnosticMessages.unexpectedToken('for each'),
                DiagnosticMessages.unexpectedToken('goto'),
                DiagnosticMessages.unexpectedToken('done'),
                DiagnosticMessages.unexpectedToken('print')
            ]);
            //the flagged statements are kept, so the rest of the block parses normally
            const body = (statements[0] as WithStatement).body.statements;
            expect(body.map(x => x.kind)).to.eql([
                'DottedSetStatement',
                'PrintStatement',
                'ExpressionStatement',
                'AssignmentStatement',
                'IfStatement',
                'ForEachStatement',
                'GotoStatement',
                'LabelStatement',
                'WithStatement',
                'ExpressionStatement'
            ]);
        });

        it('flags only the first token of the offending statement', () => {
            const { parser } = parseBody(`
                with target
                    .text = "Hello"
                    print .text
                end with
            `);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.unexpectedToken('print'),
                location: { range: util.createRange(5, 20, 5, 25) }
            }]);
        });

        it('flags disallowed statements in the single-line colon form', () => {
            const { parser } = parseBody(`
                with target: .a = 1: print .a: .b = 2: end with
            `);
            expectDiagnostics(parser, [
                DiagnosticMessages.unexpectedToken('print')
            ]);
        });

        it('does not restrict the statements of a function defined in the block', () => {
            const { parser } = parseBody(`
                with target
                    .callback = function()
                        print "hello"
                    end function
                end with
            `);
            expectZeroDiagnostics(parser);
        });
    });

    it('recovers when a line has only a dot', () => {
        const { parser, statements } = parseBody(`
            with target
                .
                .name = "x"
            end with
        `);
        expectDiagnostics(parser, [
            DiagnosticMessages.expectedIdentifier(),
            DiagnosticMessages.expectedStatement()
        ]);
        //the dot is kept in the AST so the language server can offer completions for it
        const body = (statements[0] as WithStatement).body.statements;
        expect(body).to.be.lengthOf(2);
        expect((body[0] as ExpressionStatement).expression).to.be.instanceof(WithContextExpression);
    });
});
