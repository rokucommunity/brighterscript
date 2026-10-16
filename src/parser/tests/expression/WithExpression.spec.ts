import { expect } from '../../../chai-config.spec';
import { ParseMode, Parser } from '../../Parser';
import type { AssignmentStatement, DottedSetStatement, ExpressionStatement, IncrementStatement, IndexedSetStatement, ReturnStatement } from '../../Statement';
import type { Statement } from '../../AstNode';
import type { CallExpression, DottedGetExpression, FunctionExpression, IndexedGetExpression } from '../../Expression';
import { WithContextExpression, WithExpression } from '../../Expression';
import { isDottedSetStatement, isExpressionStatement, isFunctionExpression, isWithContextExpression, isWithExpression } from '../../../astUtils/reflection';
import { expectDiagnostics, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { util } from '../../../util';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { WalkMode } from '../../../astUtils/visitors';

describe('parser with expression', () => {
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

    /**
     * Get the `with` expression from a standalone `with` block, which is wrapped in an `ExpressionStatement`
     */
    function withOf(statement: Statement): WithExpression {
        expect(isExpressionStatement(statement)).to.be.true;
        return (statement as ExpressionStatement).expression as WithExpression;
    }

    /**
     * Is this a standalone `with` block?
     */
    function isWithBlock(statement: Statement) {
        return isExpressionStatement(statement) && isWithExpression(statement.expression);
    }

    /**
     * The kind of a statement, or `WithExpression` for a standalone `with` block
     */
    function kindOf(statement: Statement) {
        return isWithBlock(statement) ? 'WithExpression' : statement.kind;
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
        const stmt = withOf(statements[0]);
        expect(stmt).to.be.instanceof(WithExpression);
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
        const set = withOf(statements[0]).body.statements[0] as DottedSetStatement;
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
        const body = withOf(statements[0]).body.statements;
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

        //every with context in the block resolves to this with expression
        const contexts = statements[0].findChildren<WithContextExpression>(isWithContextExpression, { walkMode: WalkMode.visitAllRecursive });
        expect(contexts.length).to.be.greaterThan(10);
        for (const context of contexts) {
            expect(context.getWithExpression()).to.equal(withOf(statements[0]));
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
        const body = withOf(statements[0]).body.statements;
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
        const outer = withOf(statements[0]);
        expect(outer.body.statements).to.be.lengthOf(3);
        const inner = withOf(outer.body.statements[1]);
        expect(inner).to.be.instanceof(WithExpression);

        //`with .customer` refers to the OUTER block
        const innerTarget = inner.expression as DottedGetExpression;
        expect(innerTarget.tokens.name.text).to.eql('customer');
        expect((innerTarget.obj as WithContextExpression).getWithExpression()).to.equal(outer);

        //`.name` inside the inner block refers to the INNER block
        const innerSet = inner.body.statements[0] as DottedSetStatement;
        expect((innerSet.obj as WithContextExpression).getWithExpression()).to.equal(inner);

        //`.total` after the inner block refers to the outer block again
        const outerSet = outer.body.statements[2] as DottedSetStatement;
        expect((outerSet.obj as WithContextExpression).getWithExpression()).to.equal(outer);

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
        //the with expression itself and its own members survive
        const contexts = statements[0].findChildren<WithContextExpression>(isWithContextExpression, { walkMode: WalkMode.visitAllRecursive });
        expect(contexts).to.be.lengthOf(2);
        for (const context of contexts) {
            expect(context.getWithExpression()).to.equal(withOf(statements[0]));
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
        expect(withOf(statements[0]).body.statements).to.be.lengthOf(2);
    });

    it('accepts `endwith` as the terminator', () => {
        const { parser, statements } = parseBody(`
            with target
                .a = 1
            endwith
        `);
        expectZeroDiagnostics(parser);
        expect(withOf(statements[0]).tokens.endWith.text).to.eql('endwith');
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
        expect(statements.every(isWithBlock)).to.be.true;
        expect(withOf(statements[1]).expression.kind).to.eql('GroupingExpression');
        expect(withOf(statements[2]).expression.kind).to.eql('ArrayLiteralExpression');
        //none of these are plain variables, so each needs a local
        expect(statements.map(withOf).every(x => x.usesTempVariable())).to.be.true;
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
        expect(withOf(statements[0])).to.be.instanceof(WithExpression);
    });

    it('flags `with` in BrightScript files', () => {
        const { parser } = parseBody(`
            with target
                .a = 1
            end with
        `, ParseMode.BrightScript);
        expectDiagnostics(parser, [
            DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('with expression')
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
                expect(statements.some(isWithBlock)).to.be.false;
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
            expect(statements.map(kindOf)).to.eql([
                'DottedSetStatement',
                'WithExpression',
                'ExpressionStatement',
                'WithExpression',
                'IndexedSetStatement',
                'WithExpression'
            ]);
            //`with .a` is a nested block whose target is `.a` of the outer block
            const inner = withOf(withOf(statements[1]).body.statements[0]);
            expect(inner).to.be.instanceof(WithExpression);
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
            const body = withOf(statements[0]).body.statements;
            expect(body.map(kindOf)).to.eql([
                'DottedSetStatement',
                'PrintStatement',
                'ExpressionStatement',
                'AssignmentStatement',
                'IfStatement',
                'ForEachStatement',
                'GotoStatement',
                'LabelStatement',
                'WithExpression',
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

    describe('as the value of an assignment or return', () => {
        it('parses a with expression as the value of an assignment', () => {
            const { parser, statements } = parseBody(`
                scene = with utils.getScene()
                    .backgroundColor = "red"
                    .setFocus(true)
                end with
            `);
            expectZeroDiagnostics(parser);
            expect(statements).to.be.lengthOf(1);
            const assignment = statements[0] as AssignmentStatement;
            expect(assignment.kind).to.eql('AssignmentStatement');
            expect(assignment.tokens.name.text).to.eql('scene');
            const withExpression = assignment.value as WithExpression;
            expect(withExpression).to.be.instanceof(WithExpression);
            expect(withExpression.isAssignmentValue()).to.be.true;
            expect(withExpression.body.statements).to.be.lengthOf(2);
            //the assigned variable holds the target, so no temp local is needed
            expect(withExpression.usesTempVariable()).to.be.false;
        });

        it('parses a with expression as the value of a typed assignment', () => {
            const { parser, statements } = parseBody(`
                label as object = with target.label
                    .text = "x"
                end with
            `);
            expectZeroDiagnostics(parser);
            const assignment = statements[0] as AssignmentStatement;
            expect(assignment.typeExpression).to.exist;
            expect(assignment.value).to.be.instanceof(WithExpression);
        });

        it('parses a with expression as the value of a return statement', () => {
            const { parser, statements } = parseBody(`
                return with utils.getScene()
                    .backgroundColor = "red"
                end with
            `);
            expectZeroDiagnostics(parser);
            expect(statements).to.be.lengthOf(1);
            const returnStatement = statements[0] as ReturnStatement;
            expect(returnStatement.kind).to.eql('ReturnStatement');
            const withExpression = returnStatement.value as WithExpression;
            expect(withExpression).to.be.instanceof(WithExpression);
            expect(withExpression.isReturnValue()).to.be.true;
            expect(withExpression.usesTempVariable()).to.be.true;
        });

        it('resolves leading-dot members to the with expression in every position', () => {
            const { parser, statements } = parseBody(`
                with target
                    .a = 1
                end with
                x = with target
                    .a = 1
                end with
                return with target
                    .a = 1
                end with
            `);
            expectZeroDiagnostics(parser);
            const withExpressions = [
                withOf(statements[0]),
                (statements[1] as AssignmentStatement).value as WithExpression,
                (statements[2] as ReturnStatement).value as WithExpression
            ];
            for (const withExpression of withExpressions) {
                const set = withExpression.body.statements[0] as DottedSetStatement;
                expect((set.obj as WithContextExpression).getWithExpression()).to.equal(withExpression);
            }
        });

        it('lets a statement-only walk reach the body in every position', () => {
            const { parser } = parseBody(`
                with target
                    .a = 1
                end with
                x = with target
                    .b = 1
                end with
                return with target
                    .c = 1
                end with
            `);
            //walk statements only (no expressions) from the function body
            const body = parser.ast.findChild<FunctionExpression>(isFunctionExpression).body;
            const sets = body.findChildren<DottedSetStatement>(isDottedSetStatement, { walkMode: WalkMode.visitStatements });
            expect(sets.map(x => x.tokens.name.text)).to.eql(['a', 'b', 'c']);
        });

        it('applies the body rules to the assignment and return forms', () => {
            const { parser } = parseBody(`
                x = with target
                    print .a
                end with
                return with target
                    runFunction()
                end with
            `);
            expectDiagnostics(parser, [
                DiagnosticMessages.unexpectedToken('print'),
                DiagnosticMessages.unexpectedToken('runFunction')
            ]);
        });

        it('still reads `with` as a variable when it does not begin a block', () => {
            for (const mode of [ParseMode.BrightScript, ParseMode.BrighterScript]) {
                const parser = Parser.parse(`
                    sub main()
                        x = with
                        y = with + 1
                        z = with or false
                        w = with(1)
                        v = with.foo
                        print with x
                    end sub
                    function a()
                        return with
                    end function
                    function b()
                        return with * 2
                    end function
                `, { mode: mode });
                expectZeroDiagnostics(parser);
                expect(parser.ast.findChildren(isWithExpression, { walkMode: WalkMode.visitAllRecursive })).to.be.empty;
            }
        });

        it('flags anything following the block in an assignment or return', () => {
            const { parser, statements } = parseBody(`
                x = with target
                    .a = 1
                end with + 1
            `);
            expect(parser.diagnostics.map(x => x.code)).to.include(DiagnosticMessages.expectedNewlineOrColon().code);
            expect((statements[0] as AssignmentStatement).value).to.be.instanceof(WithExpression);
        });

        it('does not parse a with expression anywhere else', () => {
            for (const text of [
                'y = 1 + with target',
                'm.foo = with target',
                'x += with target',
                'foo(with target)',
                'for i = with target to 10'
            ]) {
                const { parser } = parseBody(`
                    ${text}
                        .a = 1
                    end with
                `);
                expect(parser.diagnostics, text).not.to.be.empty;
                expect(parser.ast.findChildren(isWithExpression, { walkMode: WalkMode.visitAllRecursive }), text).to.be.empty;
            }
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
        const body = withOf(statements[0]).body.statements;
        expect(body).to.be.lengthOf(2);
        expect((body[0] as ExpressionStatement).expression).to.be.instanceof(WithContextExpression);
    });
});
