/* eslint-disable no-multi-spaces */
import type { CancellationToken } from 'vscode-languageserver';
import { CancellationTokenSource, Range } from 'vscode-languageserver';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import type { Statement } from '../parser/Statement';
import { PrintStatement, Block, ReturnStatement } from '../parser/Statement';
import type { Expression } from '../parser/Expression';
import { TokenKind } from '../lexer';
import { createVisitor, WalkMode, walkStatements } from './visitors';
import { isPrintStatement } from './reflection';
import { createToken } from './creators';
import { createStackedVisitor } from './stackedVisitor';
import type { AfterFileParseEvent } from '../interfaces';

describe('astUtils visitors', () => {
    const rootDir = process.cwd();
    let program: Program;

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
    });
    afterEach(() => {
        program.dispose();
    });

    function functionsWalker(visitor: (statement: Statement, parent: Statement) => void, cancel?: CancellationToken) {
        return (file: BrsFile) => {
            file.parser.references.functionExpressions.some(functionExpression => {
                visitor(functionExpression.body, undefined);
                walkStatements(functionExpression.body, (statement, parent) => visitor(statement, parent), cancel);
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
                afterFileParse: (event) => walker(event.file as BrsFile)
            });
            program.setFile('source/main.brs', PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block:0',                // Main sub body
                'PrintStatement:1',       // print 1
                'PrintStatement:1',       // print 2
                'FunctionStatement:1',    // function exec(s)
                'ExpressionStatement:1',  // exec(...)
                'IfStatement:1',          // if a = 1
                'Block:2',                // then block
                'PrintStatement:3',       // print 3
                'IfStatement:2',          // elseif statement
                'Block:3',                // elseif block
                'PrintStatement:4',       // print 4
                'Block:3',                // else block
                'PrintStatement:4',       // print 5
                'WhileStatement:1',       // while a <> invalid
                'Block:2',                // while block
                'PrintStatement:3',       // print 6
                'ForStatement:1',         // for a = 1 to 10
                'AssignmentStatement:2',  // a = 1
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
                afterFileParse: (event) => walker(event.file as BrsFile)
            });
            program.setFile('source/file.brs', PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block',                // Main sub body
                'PrintStatement',       // print 1
                'PrintStatement',       // print 2
                'FunctionStatement',    // function exec(s)
                'ExpressionStatement',  // exec(...)
                'IfStatement',          // if a = 1
                'Block',                // then block
                'PrintStatement',       // print 3
                'IfStatement',          // elseif statement
                'Block',                // elseif block
                'PrintStatement',       // print 4
                'Block',                // else block
                'PrintStatement',       // print 5
                'WhileStatement',       // while a <> invalid
                'Block',                // while block
                'PrintStatement',       // print 6
                'ForStatement',         // for a = 1 to 10
                'AssignmentStatement',  // a = 1
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
                afterFileParse: (event: AfterFileParseEvent) => {
                    walker(event.file as BrsFile);
                }
            });
            program.setFile('source/file.brs', PRINTS_SRC);
            expect(actual).to.deep.equal([
                'Block',                // Main sub body
                'PrintStatement',       // print 1
                'PrintStatement',       // print 2
                'FunctionStatement',    // function exec(s)
                'ExpressionStatement',  // exec(...)
                'IfStatement',          // if a = 1
                'Block',                // then block
                'PrintStatement',       // print 3
                'IfStatement',          // elseif statement
                'Block',                // elseif block
                'PrintStatement'        // print 4
            ]);
        });
    });

    describe('Statement visitor', () => {
        it('Maps statements to individual handlers', () => {
            const printHandler = sinon.spy();
            const blockHandler = sinon.spy();
            const visitor = createVisitor({
                PrintStatement: printHandler,
                Block: blockHandler
            });
            const printStatement = new PrintStatement({
                print: createToken(TokenKind.Print)
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
            const printStatement1 = new PrintStatement({
                print: createToken(TokenKind.Print)
            }, []);
            const printStatement2 = new PrintStatement({
                print: createToken(TokenKind.Print)
            }, []);
            const block = new Block([
                printStatement1,
                new ReturnStatement({ return: createToken(TokenKind.Return) })
            ], Range.create(0, 0, 0, 0));
            const visitor = createVisitor({
                PrintStatement: () => printStatement2
            });
            walkStatements(block, visitor);
            expect(block.statements[0]).to.equal(printStatement2);
        });
    });

    describe('Expressions', () => {
        it('Walks through all expressions', () => {
            const actual = [];
            let curr: { statement: Statement; depth: number };
            const statementVisitor = createStackedVisitor((statement: Statement, stack: Statement[]) => {
                curr = { statement: statement, depth: stack.length };
            });
            function expressionVisitor(expression: Expression, _: Statement | Expression) {
                const { statement, depth } = curr;
                actual.push(`${statement.constructor.name}:${depth}:${expression.constructor.name}`);
            }
            const walker = functionsWalker((statement, parentStatement) => {
                statementVisitor(statement, parentStatement);
                statement.walk(expressionVisitor, {
                    walkMode: WalkMode.visitLocalExpressions
                });
            });
            program.plugins.add({
                name: 'walker',
                afterFileParse: (event) => walker(event.file as BrsFile)
            });

            program.setFile('source/file.brs', EXPRESSIONS_SRC);
            expect(actual).to.deep.equal([
                //The comment statement is weird because it can't be both a statement and expression, but is treated that way. Just ignore it for now until we refactor comments.
                //'CommentStatement:1:CommentStatement',          // '<comment>
                'PrintStatement:1:LiteralExpression',             // print <"msg">; 3
                'PrintStatement:1:LiteralExpression',             // print "msg"; <3>
                'PrintStatement:1:TemplateStringExpression',      // print <`expand ${var}`>
                'PrintStatement:1:TemplateStringQuasiExpression', // print `<expand >${var}`
                'PrintStatement:1:LiteralExpression',             // print `<"expand ">${var}`
                'PrintStatement:1:VariableExpression',            // print `expand ${<var>}`
                'PrintStatement:1:TemplateStringQuasiExpression', // print `expand ${var}<>`
                'PrintStatement:1:LiteralExpression',             // print `expand ${var}<"">`
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
                'AssignmentStatement:2:LiteralExpression',        // for <i = 1> to 10
                'ForEachStatement:1:VariableExpression',          // for each n in <aa>
                'WhileStatement:1:BinaryExpression',              // while <i < 10>
                'WhileStatement:1:VariableExpression',            // while <i> < 10
                'WhileStatement:1:LiteralExpression',             // while i < <10>
                'IncrementStatement:3:VariableExpression',        //   <i>++
                'IfStatement:1:BinaryExpression',                 // if <j > 0>
                'IfStatement:1:VariableExpression',               // if <j> > 0
                'IfStatement:1:LiteralExpression',                // if j > <0>
                'IfStatement:2:BinaryExpression',                 // else if <j < -10>
                'IfStatement:2:VariableExpression',               // else if <j> < -10
                'IfStatement:2:UnaryExpression',                  // else if j < <-10>
                'IfStatement:2:LiteralExpression',                // else if j < -<10>
                'ReturnStatement:1:LiteralExpression'             // return <invalid>
            ]);
        });
    });

    describe('walk', () => {
        function testWalk(text: string, expectedConstructors: string[], walkMode = WalkMode.visitAllRecursive) {
            const file = program.setFile<BrsFile>('source/main.bs', text);
            const items = [];
            let index = 1;
            file.ast.walk((element: any) => {
                element._testId = index++;
                items.push(element);
            }, {
                walkMode: walkMode
            });
            index = 1;
            expect(items.map(x => `${x.constructor.name}:${x._testId}`)).to.eql(expectedConstructors.map(x => `${x}:${index++}`));
        }

        it('Walks through all expressions until cancelled', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub logger(message = "nil" as string)
                    innerLog = sub(message = "nil" as string)
                        print message
                    end sub
                    innerLog(message)
                end sub
            `);

            const cancel = new CancellationTokenSource();
            let count = 0;
            const stopIndex = 5;

            file.ast.walk((statement, parent) => {
                count++;
                if (count === stopIndex) {
                    cancel.cancel();
                }
            }, {
                walkMode: WalkMode.visitAllRecursive,
                cancel: cancel.token
            });

            expect(count).to.equal(stopIndex);
        });

        it('walks if statement', () => {
            testWalk(`
                sub main()
                    if true then
                        print "true"
                    else if true then
                        print "true"
                    else
                        print "true"
                    end if
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                //if
                'IfStatement',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',
                //else if
                'IfStatement',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',
                //else
                'Block',
                'PrintStatement',
                'LiteralExpression'
            ]);
        });

        it('walks if statement without else', () => {
            testWalk(`
                sub main()
                    if true then
                        print "true"
                    end if
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'IfStatement',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression'
            ]);
        });

        it('walks increment statement', () => {
            testWalk(`
                sub main()
                    age = 12
                    age++
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'LiteralExpression',
                'IncrementStatement',
                'VariableExpression'
            ]);
        });

        it('walks ForStatement', () => {
            testWalk(`
                sub main()
                    for i = 0 to 10 step 1
                        print i
                    end for
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'ForStatement',
                'AssignmentStatement',
                'LiteralExpression',
                'LiteralExpression',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'VariableExpression'
            ]);
        });

        it('walks ForEachStatement', () => {
            testWalk(`
                sub main()
                    for each item in [1,2,3]
                        print item
                    end for
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'ForEachStatement',
                'ArrayLiteralExpression',
                'LiteralExpression',
                'LiteralExpression',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'VariableExpression'
            ]);
        });

        it('walks dotted and indexed set statements', () => {
            testWalk(`
                sub main()
                    person = {}
                    person.name = "person"
                    person["age"] = 12
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'AALiteralExpression',
                'DottedSetStatement',
                'VariableExpression',
                'LiteralExpression',
                'IndexedSetStatement',
                'VariableExpression',
                'LiteralExpression',
                'LiteralExpression'
            ]);
        });

        it('walks while loop', () => {
            testWalk(`
                sub main()
                    while 1 + 1 = 2
                        print "infinite"
                    end while
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'WhileStatement',
                'BinaryExpression',
                'BinaryExpression',
                'LiteralExpression',
                'LiteralExpression',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression'
            ]);
        });

        it('walks namespace', () => {
            testWalk(`
               namespace NameA.NameB
               end namespace
            `, [
                'NamespaceStatement',
                'NamespacedVariableNameExpression',
                'DottedGetExpression',
                'VariableExpression'
            ]);
        });

        it('walks nested functions', () => {
            testWalk(`
                sub main()
                    print "main"
                    inner1 = sub()
                        print "inner1"
                        inner2 = sub()
                            print "inner2"
                            inner3 = sub()
                                print "inner3"
                            end sub
                        end sub
                    end sub
                end sub
            `, [
                //sub main()
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',

                //inner1 = sub()
                'AssignmentStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',

                //inner2 = sub()
                'AssignmentStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',

                //inner3 = sub
                'AssignmentStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression'
            ]);
        });

        it('walks CallExpression', () => {
            testWalk(`
                sub main()
                    Sleep(123)
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'ExpressionStatement',
                'CallExpression',
                'VariableExpression',
                'LiteralExpression'
            ]);
        });

        it('walks function parameters', () => {
            testWalk(`
                sub main(arg1)
                    speak = sub(arg1, arg2)
                    end sub
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'FunctionParameterExpression',
                'Block',
                'AssignmentStatement',
                'FunctionExpression',
                'FunctionParameterExpression',
                'FunctionParameterExpression',
                'Block'
            ]);
        });

        it('walks DottedGetExpression', () => {
            testWalk(`
                sub main()
                    print person.name
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'DottedGetExpression',
                'VariableExpression'
            ]);
        });

        it('walks XmlAttributeGetExpression', () => {
            testWalk(`
                sub main()
                    print person@name
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'XmlAttributeGetExpression',
                'VariableExpression'
            ]);
        });

        it('walks IndexedGetExpression', () => {
            testWalk(`
                sub main()
                    print person["name"]
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'IndexedGetExpression',
                'VariableExpression',
                'LiteralExpression'
            ]);
        });

        it('walks GroupingExpression', () => {
            testWalk(`
                sub main()
                    print 1 + ( 1 + 2 )
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'BinaryExpression',
                'LiteralExpression',
                'GroupingExpression',
                'BinaryExpression',
                'LiteralExpression',
                'LiteralExpression'
            ]);
        });

        it('walks AALiteralExpression', () => {
            testWalk(`
                sub main()
                    person = {
                        'comment
                        "name": "John Doe"
                    }
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'AALiteralExpression',
                'CommentStatement',
                'AAMemberExpression',
                'LiteralExpression'
            ]);
        });

        it('walks UnaryExpression', () => {
            testWalk(`
                sub main()
                   isAlive = not isDead
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'UnaryExpression',
                'VariableExpression'
            ]);
        });

        it('walks TemplateStringExpression', () => {
            testWalk(`
                sub main()
                   print \`Hello \${worldVar}\`
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'TemplateStringExpression',
                'TemplateStringQuasiExpression',
                'LiteralExpression',
                'VariableExpression',
                'TemplateStringQuasiExpression',
                'LiteralExpression'
            ]);
        });

        it('walks ReturnStatement with or without value', () => {
            testWalk(`
                sub main()
                    a = 0
                    if a = 0 then
                        return
                    else if a > 0 then
                        return 1
                    else
                        return 'nothing
                    end if
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'LiteralExpression',
                //if
                'IfStatement',
                'BinaryExpression',
                'VariableExpression',
                'LiteralExpression',
                'Block',
                'ReturnStatement',
                //else if
                'IfStatement',
                'BinaryExpression',
                'VariableExpression',
                'LiteralExpression',
                'Block',
                'ReturnStatement',
                'LiteralExpression',
                //else
                'Block',
                'ReturnStatement',
                'CommentStatement'
            ]);
        });

        it('walks TaggedTemplateStringExpression', () => {
            testWalk(`
                sub main()
                   print tag\`Hello \${worldVar}\`
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'TaggedTemplateStringExpression',
                'TemplateStringQuasiExpression',
                'LiteralExpression',
                'VariableExpression',
                'TemplateStringQuasiExpression',
                'LiteralExpression'
            ]);
        });

        it('walks CharCodeLiteral expression within TemplateLiteralExpression', () => {
            testWalk(`
                sub main()
                   print \`\\n\`
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'TemplateStringExpression',
                'TemplateStringQuasiExpression',
                'LiteralExpression',
                'EscapedCharCodeLiteralExpression',
                'LiteralExpression'
            ]);
        });

        it('walks NewExpression', () => {
            testWalk(`
                sub main()
                  person = new Person()
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'NewExpression',
                'CallExpression',
                'NamespacedVariableNameExpression',
                'VariableExpression'
            ]);
        });

        it('walks CallfuncExpression', () => {
            testWalk(`
                sub main()
                  person@.doSomething("arg1")
                end sub
            `, [
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'ExpressionStatement',
                'CallfuncExpression',
                'VariableExpression',
                'LiteralExpression'
            ]);
        });

        it('walks ClassStatement', () => {
            testWalk(`
                class Person
                    name as string
                    age as integer = 1
                    function getName()
                        return m.name
                    end function
                end class
            `, [
                'ClassStatement',
                'ClassFieldStatement',
                'ClassFieldStatement',
                'LiteralExpression',
                'ClassMethodStatement',
                'FunctionExpression',
                'Block',
                'ReturnStatement',
                'DottedGetExpression',
                'VariableExpression'
            ]);
        });

        it('visits all statements and no expressions', () => {
            testWalk(`
                sub main()
                    log = sub(message)
                        print "hello " + message
                    end sub
                    log("hello" + " world")
                end sub
            `, [
                'FunctionStatement',
                'Block',
                'AssignmentStatement',
                'Block',
                'PrintStatement',
                'ExpressionStatement'
            ], WalkMode.visitStatementsRecursive);
        });

        it('visits all expressions and no statement', () => {
            testWalk(`
                sub main()
                    log = sub(message)
                        print "hello " + message
                    end sub
                    log("hello" + " world")
                end sub
            `, [
                'FunctionExpression',
                'FunctionExpression',
                'FunctionParameterExpression',
                'BinaryExpression',
                'LiteralExpression',
                'VariableExpression',
                'CallExpression',
                'VariableExpression',
                'BinaryExpression',
                'LiteralExpression',
                'LiteralExpression'
            ], WalkMode.visitExpressionsRecursive);
        });
    });
});
