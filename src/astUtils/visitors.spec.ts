/* eslint-disable no-multi-spaces */
import { CancellationToken, CancellationTokenSource, Position, Range } from 'vscode-languageserver';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Program } from '../Program';
import { BrsFile } from '../files/BrsFile';
import { Statement, PrintStatement, Block, ReturnStatement } from '../parser/Statement';
import { Expression } from '../parser/Expression';
import { TokenKind } from '../lexer';
import { walkStatements, createStatementVisitor, createStatementExpressionsVisitor } from './visitors';
import { isPrintStatement } from './reflection';
import { createToken } from './creators';
import { createStackedVisitor } from './stackedVisitor';

describe('astUtils visitors', () => {
    const rootDir = process.cwd();
    let program: Program;
    let file: BrsFile;

    const PRINTS_SRC = `
        sub Main()
            print 1
            print 2

            function exec(s)
                s()
            end function

            exec(sub()
                print 8
            end sub)

            if a = 1
                print 3
            else if a = 2
                print 4
            else
                print 5
            end if

            while a <> invalid
                print 6
            end while

            for a = 1 to 10
                print 7
            end for
        end sub
    `;

    const EXPRESSIONS_SRC = `
        sub Main()
            'comment
            print "msg"; 3
            print \`expand \${var}\`
            a = "a"
            b = "b" + c
            m.global.x = "x"
            aa[10] = "aa"
            exec("e", some())
            for i = 1 to 10
            end for
            for each n in aa
            end for
            while i < 10
                i++
            end while
            if j > 0
            else if j < -10
            end if
            return invalid
        end sub
    `;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        file = new BrsFile('abs.bs', 'rel.bs', program);
    });
    afterEach(() => {
        program.dispose();
    });

    function functionsWalker(visitor: (s: Statement, p: Statement) => void, cancel?: CancellationToken) {
        return (file: BrsFile) => {
            file.parser.functionExpressions.some(f => {
                walkStatements(f.body, (s, p) => visitor(s, p), cancel);
                return cancel?.isCancellationRequested;
            });
        };
    }

    describe('Statements', () => {
        it('Walks through all the statements with depth', () => {
            const actual: string[] = [];
            const visitor = createStackedVisitor((s: Statement, stack: Statement[]) => {
                const d = stack.length;
                actual.push(`${s.constructor.name}:${d}`);
            });
            const walker = functionsWalker(visitor);
            program.plugins.add({
                name: 'walker',
                afterFileParse: () => walker(file)
            });
            file.parse(PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block:0',                // Main sub body
                'PrintStatement:1',       // print 1
                'PrintStatement:1',       // print 2
                'FunctionStatement:1',    // function exec(s)
                'ExpressionStatement:1',  // exec(...)
                'IfStatement:1',          // if a = 1
                'Block:2',                // then block
                'PrintStatement:3',       // print 3
                'Block:2',                // elseif block
                'PrintStatement:3',       // print 4
                'Block:2',                // else block
                'PrintStatement:3',       // print 5
                'WhileStatement:1',       // while a <> invalid
                'Block:2',                // while block
                'PrintStatement:3',       // print 6
                'ForStatement:1',         // for a = 1 to 10
                'Block:2',                // for block
                'PrintStatement:3',       // print 7
                'Block:0',                // function exec body
                'ExpressionStatement:1',  //   s()
                'Block:0',                // anon sub body
                'PrintStatement:1'        //   print 8
            ]);
        });

        it('Walks through all the statements with token not cancelled', () => {
            const cancel = new CancellationTokenSource();
            const actual: string[] = [];
            const walker = functionsWalker(s => actual.push(s.constructor.name), cancel.token);
            program.plugins.add({
                name: 'walker',
                afterFileParse: () => walker(file)
            });
            file.parse(PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block',                // Main sub body
                'PrintStatement',       // print 1
                'PrintStatement',       // print 2
                'FunctionStatement',    // function exec(s)
                'ExpressionStatement',  // exec(...)
                'IfStatement',          // if a = 1
                'Block',                // then block
                'PrintStatement',       // print 3
                'Block',                // elseif block
                'PrintStatement',       // print 4
                'Block',                // else block
                'PrintStatement',       // print 5
                'WhileStatement',       // while a <> invalid
                'Block',                // while block
                'PrintStatement',       // print 6
                'ForStatement',         // for a = 1 to 10
                'Block',                // for block
                'PrintStatement',       // print 7
                'Block',                // function exec body
                'ExpressionStatement',  //   s()
                'Block',                // anon sub body
                'PrintStatement'        //   print 8
            ]);
        });

        it('Stops walking when requested', () => {
            const cancel = new CancellationTokenSource();
            const actual: string[] = [];
            let count = 0;
            const walker = functionsWalker(s => {
                actual.push(s.constructor.name);
                if (isPrintStatement(s)) {
                    if (++count === 4) {
                        cancel.cancel();
                    }
                }
            }, cancel.token);
            program.plugins.add({
                name: 'walker',
                afterFileParse: () => walker(file)
            });
            file.parse(PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block',                // Main sub body
                'PrintStatement',       // print 1
                'PrintStatement',       // print 2
                'FunctionStatement',    // function exec(s)
                'ExpressionStatement',  // exec(...)
                'IfStatement',          // if a = 1
                'Block',                // then block
                'PrintStatement',       // print 3
                'Block',                // elseif block
                'PrintStatement'        // print 4
            ]);
        });
    });

    describe('Statement visitor', () => {
        it('Maps statements to individual handlers', () => {
            const printHandler = sinon.spy();
            const blockHandler = sinon.spy();
            const visitor = createStatementVisitor({
                PrintStatement: printHandler,
                Block: blockHandler
            });
            const printStatement = new PrintStatement({
                print: createToken(TokenKind.Print, Position.create(0, 0))
            }, []);
            const blockStatement = new Block([], Range.create(0, 0, 0, 0));
            visitor(printStatement, undefined);
            visitor(blockStatement, undefined);
            expect(printHandler.callCount).to.equal(1);
            expect(printHandler.calledWith(printStatement)).to.be.true;
            expect(blockHandler.callCount).to.equal(1);
            expect(blockHandler.calledWith(blockStatement)).to.be.true;
        });
    });

    describe('Statement editor', () => {
        it('allows replacing statements', () => {
            const pos = Position.create(0, 0);
            const printStatement1 = new PrintStatement({
                print: createToken(TokenKind.Print, pos)
            }, []);
            const printStatement2 = new PrintStatement({
                print: createToken(TokenKind.Print, pos)
            }, []);
            const block = new Block([
                printStatement1,
                new ReturnStatement({ return: createToken(TokenKind.Return, pos) })
            ], Range.create(0, 0, 0, 0));
            const visitor = createStatementVisitor({
                PrintStatement: () => printStatement2
            });
            walkStatements(block, visitor);
            expect(block.statements[0]).to.equal(printStatement2);
        });
    });

    describe('Expressions', () => {
        it('Walks through all expressions', () => {
            const actual = [];
            let curr: { s: Statement; d: number };
            const visitor = createStackedVisitor((s: Statement, stack: Statement[]) => {
                curr = { s: s, d: stack.length };
            });
            function expression(e: Expression) {
                const { s, d } = curr;
                actual.push(`${s.constructor.name}:${d}:${e.constructor.name}`);
            }
            const walker = functionsWalker(createStatementExpressionsVisitor(visitor, expression));
            program.plugins.add({
                name: 'walker',
                afterFileParse: () => walker(file)
            });
            file.parse(EXPRESSIONS_SRC);
            expect(actual).to.deep.equal([
                'CommentStatement:1:CommentStatement',            // <'comment>
                'PrintStatement:1:LiteralExpression',             // print <"msg">; 3
                'PrintStatement:1:LiteralExpression',             // print "msg"; <3>
                'PrintStatement:1:TemplateStringExpression',      // print <`expand ${var}`>
                'PrintStatement:1:TemplateStringQuasiExpression', // print `<expand >${var}`
                'PrintStatement:1:LiteralExpression',             // print `<"expand ">${var}`
                'PrintStatement:1:TemplateStringQuasiExpression', // print `expand ${var}<>`
                'PrintStatement:1:LiteralExpression',             // print `expand ${var}<"">`
                'PrintStatement:1:VariableExpression',            // print `expand ${<var>}`
                'AssignmentStatement:1:LiteralExpression',        // a = <"a">
                'AssignmentStatement:1:BinaryExpression',         // b = <"b" + "c">
                'AssignmentStatement:1:LiteralExpression',        // b = <"b"> + c
                'AssignmentStatement:1:VariableExpression',       // b = "b" + <c>
                'DottedSetStatement:1:DottedGetExpression',       // <m.global.x> = "x"
                'DottedSetStatement:1:VariableExpression',        // <m>.global.x = "x"
                'DottedSetStatement:1:LiteralExpression',         // m.global.x = <"x">
                'IndexedSetStatement:1:VariableExpression',       // <aa>[10] = "aa"
                'IndexedSetStatement:1:LiteralExpression',        // aa[<10>] = "aa"
                'IndexedSetStatement:1:LiteralExpression',        // aa[10] = <"aa">
                'ExpressionStatement:1:CallExpression',           // <exec("e", some())>
                'ExpressionStatement:1:VariableExpression',       // <exec>("e", some())
                'ExpressionStatement:1:LiteralExpression',        // exec(<"e">, some())
                'ExpressionStatement:1:CallExpression',           // exec("e", <some()>)
                'ExpressionStatement:1:VariableExpression',       // exec("e", <some>())
                'ForStatement:1:LiteralExpression',               // for i = <1> to 10
                'ForStatement:1:LiteralExpression',               // for i = 1 to <10>
                'ForStatement:1:LiteralExpression',               // for i = 1 to 10 <step 1>
                'ForEachStatement:1:VariableExpression',          // for each n in <aa>
                'WhileStatement:1:BinaryExpression',              // while <i < 10>
                'WhileStatement:1:VariableExpression',            // while <i> < 10
                'WhileStatement:1:LiteralExpression',             // while i < <10>
                'IncrementStatement:3:VariableExpression',        //   <i>++
                'IfStatement:1:BinaryExpression',                 // if <j > 0>
                'IfStatement:1:VariableExpression',               // if <j> > 0
                'IfStatement:1:LiteralExpression',                // if j > <0>
                'IfStatement:1:BinaryExpression',                 // else if <j < -10>
                'IfStatement:1:VariableExpression',               // else if <j> < -10
                'IfStatement:1:UnaryExpression',                  // else if j < <-10>
                'IfStatement:1:LiteralExpression',                // else if j < -<10>
                'ReturnStatement:1:LiteralExpression'             // return <invalid>
            ]);
        });

        it('Walks through all expressions until cancelled', () => {
            const actual = [];
            const cancel = new CancellationTokenSource();
            let curr: { s: Statement; d: number };
            const visitor = createStackedVisitor((s: Statement, stack: Statement[]) => {
                curr = { s: s, d: stack.length };
            });
            function expression(e: Expression) {
                const { s, d } = curr;
                actual.push(`${s.constructor.name}:${d}:${e.constructor.name}`);
                if (e.constructor.name === 'VariableExpression') {
                    cancel.cancel();
                }
            }
            const walker = functionsWalker(createStatementExpressionsVisitor(visitor, expression, cancel.token));
            program.plugins.add({
                name: 'walker',
                afterFileParse: () => walker(file)
            });
            file.parse(EXPRESSIONS_SRC);
            expect(actual).to.deep.equal([
                'CommentStatement:1:CommentStatement',            // <'comment>
                'PrintStatement:1:LiteralExpression',             // print <"msg">; 3
                'PrintStatement:1:LiteralExpression',             // print "msg"; <3>
                'PrintStatement:1:TemplateStringExpression',      // print <`expand ${var}`>
                'PrintStatement:1:TemplateStringQuasiExpression', // print `<expand >${var}`
                'PrintStatement:1:LiteralExpression',             // print `<"expand ">${var}`
                'PrintStatement:1:TemplateStringQuasiExpression', // print `expand ${var}<>`
                'PrintStatement:1:LiteralExpression',             // print `expand ${var}<"">`
                'PrintStatement:1:VariableExpression'             // print `expand ${<var>}`
            ]);
        });
    });
});
