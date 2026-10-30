/* eslint-disable no-multi-spaces */
import type { CancellationToken } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { expect } from '../chai-config.spec';
import * as sinon from 'sinon';
import { Program } from '../Program';
import type { BrsFile } from '../files/brs/BrsFile';
import type { ConditionalCompileStatement, FieldStatement, FunctionStatement } from '../files/brs/parser/Statement';
import { PrintStatement, Block, ReturnStatement, ExpressionStatement } from '../files/brs/parser/Statement';
import { TokenKind } from '../files/brs/lexer/TokenKind';
import type { WalkOptions } from './visitors';
import { ChildrenSkipper, createVisitor, InternalWalkMode, walkArray, WalkMode, walkStatements } from './visitors';
import { isBlock, isConditionalCompileStatement, isFieldStatement, isFunctionExpression, isFunctionStatement, isLiteralExpression, isPrintStatement } from './reflection';
import { createCall, createIntegerLiteral, createToken, createVariableExpression } from './creators';
import { createStackedVisitor } from './stackedVisitor';
import { Editor } from './Editor';
import { ParseMode, Parser } from '../files/brs/parser/Parser';
import type { Statement, Expression, AstNode } from '../files/brs/parser/AstNode';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import type { VariableExpression } from '../files/brs/parser/Expression';
import { BinaryExpression, type FunctionExpression, type LiteralExpression } from '../files/brs/parser/Expression';

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
            const funcExpressions = file.ast.findChildren<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitExpressionsRecursive });
            funcExpressions.some(functionExpression => {
                visitor(functionExpression.body, undefined);
                walkStatements(functionExpression.body, (statement, parent) => visitor(statement, parent), cancel);
                return cancel?.isCancellationRequested;
            });
        };
    }

    describe('createVisitor', () => {
        it(`calls the 'AstNode' event for every node`, () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub Main()
                    print "Hello"
                end sub
            `);
            const nodes: AstNode[] = [];
            function track(node: AstNode) {
                nodes.push(node);
            }
            const visitor = createVisitor({
                AstNode: track,
                FunctionStatement: track,
                FunctionExpression: track,
                PrintStatement: track,
                Block: track,
                LiteralExpression: track
            });
            file.ast.walk(visitor, { walkMode: WalkMode.visitAllRecursive });
            expect(nodes.map(x => x.constructor.name)).to.eql([
                'FunctionStatement',
                'FunctionStatement',
                'FunctionExpression',
                'FunctionExpression',
                'Block',
                'Block',
                'PrintStatement',
                'PrintStatement',
                'LiteralExpression',
                'LiteralExpression'
            ]);
        });
    });

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
                afterProvideFile: event => walker(event.files[0] as BrsFile)
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
                afterProvideFile: event => walker(event.files[0] as BrsFile)
            });
            program.setFile('source/main.brs', PRINTS_SRC);
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
                afterProvideFile: event => walker(event.files[0] as BrsFile)
            });
            program.setFile('source/main.brs', PRINTS_SRC);
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
                print: createToken(TokenKind.Print),
                expressions: []
            });
            const blockStatement = new Block({ statements: [] });
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
                print: createToken(TokenKind.Print),
                expressions: []
            });
            const printStatement2 = new PrintStatement({
                print: createToken(TokenKind.Print),
                expressions: []
            });
            const block = new Block({
                statements: [
                    printStatement1,
                    new ReturnStatement({ return: createToken(TokenKind.Return) })
                ]
            });
            const visitor = createVisitor({
                PrintStatement: () => printStatement2
            });
            walkStatements(block, visitor);
            expect(block.statements[0]).to.equal(printStatement2);
        });

        it('uses the Editor for replacement when provided', () => {
            const editor = new Editor();

            const printStatement1 = new PrintStatement({
                print: createToken(TokenKind.Print),
                expressions: []
            });

            const printStatement2 = new PrintStatement({
                print: createToken(TokenKind.Print),
                expressions: []
            });

            const block = new Block({
                statements: [printStatement1]
            });

            block.walk(createVisitor({
                PrintStatement: () => printStatement2
            }), {
                walkMode: WalkMode.visitAll,
                editor: editor
            });
            expect(block.statements[0]).to.equal(printStatement2);
            editor.undoAll();
            expect(block.statements[0]).to.equal(printStatement1);
        });
    });

    describe('Expressions', () => {
        it('Walks through all expressions', () => {
            const actual = [];
            let curr: { statement: Statement; depth: number };
            const statementVisitor = createStackedVisitor((statement: Statement, stack: Statement[]) => {
                curr = { statement: statement, depth: stack.length };
            });
            function expressionVisitor(expression: Expression, _: AstNode) {
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
                afterProvideFile: (event) => walker(event.files[0] as BrsFile)
            });

            program.setFile('source/main.brs', EXPRESSIONS_SRC);
            expect(actual).to.deep.equal([
                'PrintStatement:1:LiteralExpression',             // print <"msg">; 3
                'PrintStatement:1:PrintSeparatorExpression',      // print "msg"<;> 3
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

        it('links every ast node to its parent when walked', () => {
            const { ast } = program.setFile<BrsFile>('source/main.bs', `
                library "v30/bslCore.brs"
                import "source/main.bs"
                namespace alpha
                    namespace beta
                        sub charlie()
                            delta = 1
                            delta++
                            delta = sub()
                                'do some printing
                                print "hello"
                            end sub
                            delta()
                            for i = 0 to 10 step 1
                                exit for
                            end for
                            while false
                                exit while
                            end while
                            if true or false then
                                print 1.2
                            else
                                print 123123123123
                            end if
                            dim arr[1, 2]
                            goto theLabel
                            theLabel:
                            return false
                            end
                            stop
                            for each item in [1, 2, 3]
                                continue for
                            end for
                            obj = { name: "bob"}
                            obj.name = obj.name
                            obj["name"] = obj["name"]
                            obj.name = obj@firstName
                            print (true or false)
                            print \`true\${false}\\n\`
                            print not true
                            print FUNCTION_NAME
                            print new Person()
                            print tag\`stuff\${1}\`
                            print true ? true : false
                            print true ?? false
                            print /search stuff/g
                            try
                                obj.bob = "carl"
                                throw "e"
                            catch e
                                obj["name"] = "dale"
                            print e
                            end try
                            obj@.doCallfunc(1, 2)
                        end sub
                    end namespace
                end namespace
                @SomeAnnotation(1, "two")
                interface IPerson
                    name as string
                    function doSomething() as string
                end interface
                class Person
                    name as string = "bob"
                    function doSomething(value = true) as string
                    end function
                end class
                enum Direction
                    up = "up"
                end enum
                enum Logical
                    yes = 1
                    no = 0
                end enum
                const CONST_VALUE = 1.2
            `);
            expectZeroDiagnostics(program);
            const nodes: AstNode[] = [];
            //get every expression and statement in the file
            ast.walk((node) => {
                nodes.push(node);
            }, { walkMode: WalkMode.visitAllRecursive });

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];

                //find the top-most ast node
                let top = node;
                while (top.parent) {
                    top = top.parent;
                }
                //should be the same instance. If it doesn't then something is wrong with the .parent linking
                expect(top === ast || node === ast, `Node ${node.constructor.name} (index ${i}) has broken parent link`).to.be.true;
            }
        });

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
                'ReturnStatement'
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
                'FieldStatement',
                'TypeExpression',
                'VariableExpression',
                'FieldStatement',
                'TypeExpression',
                'VariableExpression',
                'LiteralExpression',
                'MethodStatement',
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

        it('provides owner and key', () => {
            const items = [];
            const { ast } = Parser.parse(`
                sub main()
                    log = sub(message)
                        print "hello " + message
                    end sub
                    log("hello" + " world")
                end sub
            `);
            ast.walk((astNode, parent, owner, key) => {
                items.push(astNode);
                expect(owner[key]).to.equal(astNode);
            }, {
                walkMode: WalkMode.visitAllRecursive
            });
            expect(items).to.be.length(17);
        });

        it('can be used to delete statements', () => {
            const { ast } = Parser.parse(`
                sub main()
                    print 1
                    print 2
                    print 3
                end sub
            `);
            let callCount = 0;
            ast.walk((astNode, parent, owner: Statement[], key) => {
                if (isPrintStatement(astNode)) {
                    callCount++;
                    //delete the print statement (we know owner is an array based on this specific test)
                    owner.splice(key, 1);
                }
            }, {
                walkMode: WalkMode.visitAllRecursive
            });
            //the visitor should have been called for every statement
            expect(callCount).to.eql(3);
            expect(
                (ast.statements[0] as FunctionStatement).func.body.statements
            ).to.be.lengthOf(0);
        });

        it('walks everything when the first element is replaced', () => {
            const { ast } = Parser.parse(`
                sub main()
                    print 1
                    print 2
                    print 3
                end sub
            `);
            const target = ast.findChild<Block>(isBlock).statements[0];
            let callCount = 0;
            ast.walk((astNode, parent, owner: Statement[], key) => {
                if (isPrintStatement(astNode)) {
                    callCount++;
                }
                if (astNode === target) {
                    owner.splice(key, 1);
                }
            }, {
                walkMode: WalkMode.visitAllRecursive
            });
            //the visitor should have been called for every statement
            expect(callCount).to.eql(3);
            expect(
                (ast.statements[0] as FunctionStatement).func.body.statements
            ).not.to.include(target);
        });

        it('walks everything when the middle element is replaced', () => {
            const { ast } = Parser.parse(`
                sub main()
                    print 1
                    print 2
                    print 3
                end sub
            `);
            const target = ast.findChild<Block>(isBlock).statements[1];
            let callCount = 0;
            ast.walk((astNode, parent, owner: Statement[], key) => {
                if (isPrintStatement(astNode)) {
                    callCount++;
                }
                if (astNode === target) {
                    owner.splice(key, 1);
                }
            }, {
                walkMode: WalkMode.visitAllRecursive
            });
            //the visitor should have been called for every statement
            expect(callCount).to.eql(3);
            expect(
                (ast.statements[0] as FunctionStatement).func.body.statements
            ).not.to.include(target);
        });

        it('walks everything when the end element is replaced', () => {
            const { ast } = Parser.parse(`
                sub main()
                    print 1
                    print 2
                    print 3
                end sub
            `);
            const target = ast.findChild<Block>(isBlock).statements[2];
            let callCount = 0;
            ast.walk((astNode, parent, owner: Statement[], key) => {
                if (isPrintStatement(astNode)) {
                    callCount++;
                }
                if (astNode === target) {
                    owner.splice(key, 1);
                }
            }, {
                walkMode: WalkMode.visitAllRecursive
            });
            //the visitor should have been called for every statement
            expect(callCount).to.eql(3);
            expect(
                (ast.statements[0] as FunctionStatement).func.body.statements
            ).not.to.include(target);
        });


        it('can be used to insert statements', () => {
            const { ast } = Parser.parse(`
                sub main()
                    print 1
                    print 2
                    print 3
                end sub
            `);
            let printStatementCount = 0;
            let callExpressionCount = 0;
            const calls = [];
            ast.walk(createVisitor({
                PrintStatement: (astNode, parent, owner: Statement[], key) => {
                    printStatementCount++;
                    //add another expression to the list every time. This should result in 1 the first time, 2 the second, 3 the third.
                    calls.push(new ExpressionStatement({
                        expression: createCall(
                            createVariableExpression('doSomethingBeforePrint'),
                            [
                                createIntegerLiteral(callExpressionCount.toString())
                            ]
                        )
                    }));
                    owner.splice(key + 1, 0, ...calls.map(x => x.clone()));
                },
                CallExpression: (call) => {
                    callExpressionCount++;
                    console.log('call visitor for', (call.args[0] as LiteralExpression).tokens.value.text);
                }
            }), {
                walkMode: WalkMode.visitAllRecursive
            });
            //the visitor should have been called for every statement
            expect(printStatementCount).to.eql(3);
            //since the calls were injected after each print statement, we should have 1 call for the first print, 2 for the second, and 3 for the third
            expect(callExpressionCount).to.eql(6);
            expect(
                (ast.statements[0] as FunctionStatement).func.body.statements
            ).to.be.lengthOf(9);
        });

        it('skips children when requested', () => {
            const file: BrsFile = program.setFile('source/main.bs', `
                sub test()
                    print 1 + 1
                    print "hello"
                end sub

                sub test2()
                    i = 2
                    while i > 0
                        print createObject("roDateTime").ToISOString()
                        i--
                    end while
                end sub
            `);
            const actual = new Array<string>();
            program.validate();
            expectZeroDiagnostics(program);

            // do not walk into print statements
            const skipper = new ChildrenSkipper();
            file.ast.walk((node) => {
                actual.push(node.kind);
                if (isPrintStatement(node)) {
                    skipper.skip();
                }
            }, {
                walkMode: WalkMode.visitAllRecursive,
                skipChildren: skipper
            });

            // Does not walk into print statements
            expect(actual).to.deep.equal([
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'PrintStatement',
                'PrintStatement',
                'FunctionStatement',
                'FunctionExpression',
                'Block',
                'AssignmentStatement',
                'LiteralExpression',
                'WhileStatement',
                'BinaryExpression',
                'VariableExpression',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'IncrementStatement',
                'VariableExpression'
            ]);
        });

        it('can get end trivia of any kind of block type node', () => {
            const file: BrsFile = program.setFile('source/main.bs', `
                sub test()
                    x = {
                        val: [123],
                        count: 4
                        ' end comment in literal AA 1
                    }
                    for each y in x.val
                        print y
                        ' end comment in for 2
                    end for

                    if x.count > 2
                        print "hi"
                        ' end comment in if 3
                    end if

                    while x.count > 3
                        x.count--
                        ' end comment in while 4
                    end while

                    try
                        print "in try"
                    catch e
                        ' end comment in try 5
                    end try

                    array = [
                        1,
                        2,
                        ' end comment in array 6
                    ]

                    ' end comment in function 7
                end sub
            `);
            const comments = [];
            program.validate();
            expectZeroDiagnostics(program);

            file.ast.walk(createVisitor({
                AstNode: (node) => {
                    const endNodeComments = node.endTrivia?.filter(t => t.kind === TokenKind.Comment) ?? [];
                    comments.push(...endNodeComments);
                }
            }), {
                walkMode: WalkMode.visitAllRecursive
            });
        });

        it('walks a new child when returned from a visitor', () => {
            let walkedLiterals: string[] = [];

            Parser.parse(`
                sub main()
                    print 1 + 2
                end sub
            `).ast.walk(createVisitor({
                BinaryExpression: (node, parent, owner: Statement[], key) => {
                    //replace the `1 + 2` binary expression with a new binary expression
                    if (isLiteralExpression(node.left) && node.left.tokens.value.text === '1') {
                        return new BinaryExpression({
                            left: createIntegerLiteral('3'),
                            operator: createToken(TokenKind.Plus),
                            right: createIntegerLiteral('4')
                        });
                    }
                },
                LiteralExpression: (node) => {
                    walkedLiterals.push(node.tokens.value.text);
                }
            }), {
                walkMode: WalkMode.visitAllRecursive
            });

            expect(walkedLiterals).to.eql(['3', '4']);
        });

        it('uses ast.bsConsts at the next full walk', () => {
            const { ast } = program.setFile<BrsFile>('source/main.brs', `
                #if FEATURE
                sub main()
                end sub
                #end if
            `);
            let foundMainFunc = false;
            const visitor = createVisitor({
                FunctionStatement: (func) => {
                    foundMainFunc ||= func.getName(ParseMode.BrighterScript) === 'main';
                }
            });
            ast.walk(visitor, {
                walkMode: WalkMode.visitStatementsRecursive
            });
            // did not walk false block
            expect(foundMainFunc).to.be.false;
            ast.bsConsts = new Map([['feature', true]]);
            ast.walk(visitor, {
                walkMode: WalkMode.visitStatementsRecursive
            });
            // feature is true, so it did walk block
            expect(foundMainFunc).to.be.true;
        });

        it('can walk false cc blocks', () => {
            const { ast } = program.setFile<BrsFile>('source/main.brs', `
                #if false
                sub main()
                end sub
                #end if
            `);
            let foundMainFunc = false;
            const visitor = createVisitor({
                FunctionStatement: (func) => {
                    foundMainFunc ||= func.getName(ParseMode.BrighterScript) === 'main';
                }
            });
            ast.walk(visitor, {
                walkMode: WalkMode.visitStatements
            });
            // did not walk false block
            expect(foundMainFunc).to.be.false;
            ast.walk(visitor, {
                // eslint-disable-next-line no-bitwise
                walkMode: WalkMode.visitStatements | InternalWalkMode.visitFalseConditionalCompilationBlocks
            });
            // did walk false block
            expect(foundMainFunc).to.be.true;
        });

        it('will correctly walk `not condition` cc blocks', () => {
            const { ast } = program.setFile<BrsFile>('source/main.brs', `
                #const LOGGING = false
                #if not LOGGING
                sub notDebug()
                end sub
                #end if
                #if not false
                sub notFalse()
                end sub
                #end if
            `);
            let functionsFound = new Set<string>();
            const visitor = createVisitor({
                FunctionStatement: (func) => {
                    functionsFound.add(func.getName(ParseMode.BrighterScript));
                }
            });
            ast.walk(visitor, {
                walkMode: WalkMode.visitStatements
            });
            // did walk 'not' block
            expect(functionsFound.has('notDebug')).to.be.true;
            expect(functionsFound.has('notFalse')).to.be.true;
        });

        it('evaluates literals and `not` correctly', () => {
            const { ast } = program.setFile<BrsFile>('source/main.brs', `
                #if true
                sub ifTrue()
                end sub
                #end if
                #if not true
                sub ifNotTrue()
                end sub
                #end if
                #if not false
                sub ifNotFalse()
                end sub
                #end if
            `);
            const functionsFound = new Set<string>();
            ast.walk(createVisitor({
                FunctionStatement: (func) => {
                    functionsFound.add(func.getName(ParseMode.BrighterScript));
                }
            }), {
                walkMode: WalkMode.visitStatements
            });
            expect([...functionsFound]).to.eql(['ifTrue', 'ifNotFalse']);
        });

        it('uses the file-level #const values', () => {
            const { ast } = program.setFile<BrsFile>('source/main.brs', `
                #const DEBUG = true
                #if DEBUG
                sub active()
                end sub
                #else
                sub inactive()
                end sub
                #end if
            `);
            const functionsFound = new Set<string>();
            ast.walk(createVisitor({
                FunctionStatement: (func) => {
                    functionsFound.add(func.getName(ParseMode.BrighterScript));
                }
            }), {
                walkMode: WalkMode.visitStatements
            });
            expect([...functionsFound]).to.eql(['active']);
        });

        describe('conditional compile evaluation per walk', () => {
            function collectFunctionNames(ast: AstNode, options: WalkOptions) {
                const names: string[] = [];
                ast.walk(createVisitor({
                    FunctionStatement: (func) => {
                        names.push(func.getName(ParseMode.BrighterScript));
                    }
                }), options);
                return names;
            }

            function revalidate(file: BrsFile) {
                file.isValidated = false;
                program.validate();
            }

            it('uses different branches for two full walks with different ast.bsConsts', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #else
                    sub releaseOnly()
                    end sub
                    #end if
                `);
                ast.bsConsts = new Map([['feature', true]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['debugOnly']);
                ast.bsConsts = new Map([['feature', false]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['releaseOnly']);
            });

            it('applies an edit to a conditional compile statement at the next validate', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #else
                    sub releaseOnly()
                    end sub
                    #end if
                `);
                const ast = file.ast;
                const statement = ast.findChild<ConditionalCompileStatement>(isConditionalCompileStatement);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['releaseOnly']);
                (statement.tokens as any).condition = createToken(TokenKind.True, 'true');
                revalidate(file);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['debugOnly']);
                (statement.tokens as any).not = createToken(TokenKind.Not, 'not');
                revalidate(file);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['releaseOnly']);
            });

            function createHashConst(name: string, value: boolean) {
                return Parser.parse(`#const ${name} = ${value}\n`).ast.statements[0];
            }

            it('uses a #const injected into the AST on the next full walk', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #else
                    sub releaseOnly()
                    end sub
                    #end if
                `);
                program.validate();
                const ast = file.ast;
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['releaseOnly']);
                ast.statements.unshift(createHashConst('FEATURE', true));
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['debugOnly']);
                ast.statements[0] = createHashConst('FEATURE', false);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['releaseOnly']);
            });

            it('keeps an injected #const across a validate of a file that did not change', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #end if
                `);
                program.validate();
                file.ast.statements.unshift(createHashConst('FEATURE', true));
                file.ast.link();
                program.validate();
                expect(collectFunctionNames(file.ast, { walkMode: WalkMode.visitStatements })).to.eql(['debugOnly']);
            });

            it('resolves with constants passed in the walk options, even in a partial walk, and adds each active #const to them', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #const LATE = true
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #else
                    sub releaseOnly()
                    end sub
                    #end if
                `);
                const bsConsts = new Map([['feature', true]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements, bsConsts: bsConsts })).to.eql(['debugOnly']);
                expect([...bsConsts]).to.eql([['feature', true], ['late', true]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements, bsConsts: new Map([['feature', false]]) })).to.eql(['releaseOnly']);
            });

            it('resolves again when the same options object is used for another full walk', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub debugOnly()
                    end sub
                    #else
                    sub releaseOnly()
                    end sub
                    #end if
                `);
                const options: WalkOptions = { walkMode: WalkMode.visitStatementsRecursive };
                ast.bsConsts = new Map([['feature', true]]);
                expect(collectFunctionNames(ast, options)).to.eql(['debugOnly']);
                ast.bsConsts = new Map([['feature', false]]);
                expect(collectFunctionNames(ast, options)).to.eql(['releaseOnly']);
            });

            it('does not walk a literal #if true that is nested inside an inactive branch', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if false
                        #if true
                        sub nested()
                        end sub
                        #end if
                    #end if
                    sub other()
                    end sub
                `);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['other']);
            });

            it('does not add anything to the walk options', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if true
                    sub a()
                    end sub
                    #end if
                `);
                const options: WalkOptions = { walkMode: WalkMode.visitStatementsRecursive };
                collectFunctionNames(ast, options);
                expect(Object.keys(options)).to.eql(['walkMode']);
            });

            it('walks the active branches of every statement a walk meets', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    #if true
                    sub a()
                    end sub
                    #end if
                    #if false
                    #else
                    sub b()
                    end sub
                    #end if
                    sub c()
                        #if true
                        print 1
                        #end if
                    end sub
                `);
                expect(collectFunctionNames(file.ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['a', 'b', 'c']);
            });

            it('applies a #const declared inside a function to a later #if, even in a walk that does not step into functions', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    sub a()
                        #const LATE = true
                    end sub
                    #if LATE
                    sub b()
                    end sub
                    #end if
                `);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['a', 'b']);
                ast.bsConsts.set('other', true);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatements })).to.eql(['a', 'b']);
            });

            it('sets isActive on the nodes of a branch that a full walk does not visit', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if FEATURE
                    sub a()
                    end sub
                    #end if
                `);
                // eslint-disable-next-line no-bitwise
                const func = ast.findChild<FunctionStatement>(isFunctionStatement, { walkMode: WalkMode.visitAllRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks });
                expect(func.isActive).to.be.false;
                ast.bsConsts = new Map([['feature', true]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql(['a']);
                expect(func.isActive).to.be.true;
                ast.bsConsts = new Map([['feature', false]]);
                expect(collectFunctionNames(ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql([]);
                expect(func.isActive).to.be.false;
            });

            it('does not evaluate anything when walking every branch', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if false
                    sub a()
                    end sub
                    #end if
                `);
                // eslint-disable-next-line no-bitwise
                const options: WalkOptions = { walkMode: WalkMode.visitStatements | InternalWalkMode.visitFalseConditionalCompilationBlocks };
                expect(collectFunctionNames(ast, options)).to.eql(['a']);
            });
        });

        describe('isActive across walks', () => {
            // eslint-disable-next-line no-bitwise
            const everyBranchRecursive = WalkMode.visitAllRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks;

            const source = `
                #const FEATURE = true
                #const OTHER = false
                sub main()
                    #if FEATURE
                        print "a"
                    #else if OTHER
                        print "b"
                    #else
                        print "c"
                    #end if
                    callIt(sub()
                        #if OTHER
                            print "d"
                        #end if
                        print "d2"
                    end sub)
                end sub
                #if OTHER
                    sub inactive()
                        #if FEATURE
                            print "e"
                        #end if
                    end sub
                #end if
                class Foo
                    #if FEATURE
                        a = 1
                    #else
                        b = 2
                    #end if
                end class
                namespace alpha
                    #if not FEATURE
                        sub beta()
                            print "f"
                        end sub
                    #end if
                    sub gamma()
                        print "g"
                    end sub
                end namespace
            `;

            /**
             * Every node in the tree, including the nodes of inactive branches
             */
            function getAllNodes(root: AstNode) {
                const nodes: AstNode[] = [];
                root.walk((node) => {
                    nodes.push(node);
                }, { walkMode: everyBranchRecursive });
                return nodes;
            }

            function getIsActive(nodes: AstNode[]) {
                return nodes.map(x => x.isActive);
            }

            /**
             * Find the print statement whose first item is the given string
             */
            function findPrint(root: AstNode, text: string) {
                return root.findChild<PrintStatement>((x) => {
                    return isPrintStatement(x) && (x.expressions[0] as LiteralExpression)?.tokens?.value.text === `"${text}"`;
                }, { walkMode: everyBranchRecursive });
            }

            function findFunction(root: AstNode, name: string) {
                return root.findChild<FunctionStatement>((x) => {
                    return isFunctionStatement(x) && x.tokens.name.text === name;
                }, { walkMode: everyBranchRecursive });
            }

            function findConditionalCompiles(root: AstNode) {
                return root.findChildren<ConditionalCompileStatement>(isConditionalCompileStatement, { walkMode: everyBranchRecursive });
            }

            it('marks the nodes of every inactive branch inactive, at any depth', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                expect(findPrint(ast, 'a').isActive).to.be.true;
                expect(findPrint(ast, 'b').isActive).to.be.false;
                expect(findPrint(ast, 'c').isActive).to.be.false;
                expect(findPrint(ast, 'd').isActive).to.be.false;
                expect(findPrint(ast, 'd2').isActive).to.be.true;
                expect(findFunction(ast, 'inactive').isActive).to.be.false;
                //an `#if` that is true but sits in an inactive branch is still inactive
                expect(findPrint(ast, 'e').isActive).to.be.false;
                expect(findPrint(ast, 'e').expressions[0].isActive).to.be.false;
                expect(findFunction(ast, 'beta').isActive).to.be.false;
                expect(findPrint(ast, 'f').isActive).to.be.false;
                expect(findPrint(ast, 'g').isActive).to.be.true;
                const members = ast.findChildren<FieldStatement>(isFieldStatement, { walkMode: everyBranchRecursive });
                expect(members.map(x => [x.tokens.name.text, x.isActive])).to.eql([['a', true], ['b', false]]);
            });

            it('does not change any isActive value when walking any subtree with any walk mode', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const nodes = getAllNodes(ast);
                const expected = getIsActive(nodes);
                expect(expected).not.to.include(undefined);

                /* eslint-disable no-bitwise */
                const walkModes = [
                    WalkMode.walkStatements,
                    WalkMode.visitStatements,
                    WalkMode.walkExpressions,
                    WalkMode.visitLocalExpressions,
                    WalkMode.visitExpressions,
                    WalkMode.visitAll,
                    WalkMode.recurseChildFunctions,
                    WalkMode.visitStatementsRecursive,
                    WalkMode.visitExpressionsRecursive,
                    WalkMode.visitAllRecursive
                ].flatMap(mode => [mode, mode | InternalWalkMode.visitFalseConditionalCompilationBlocks]);
                /* eslint-enable no-bitwise */

                for (const node of [ast, ...nodes]) {
                    for (const walkMode of walkModes) {
                        const optionsList: WalkOptions[] = [
                            { walkMode: walkMode },
                            { walkMode: walkMode, skipChildren: new ChildrenSkipper() },
                            { walkMode: walkMode, cancel: new CancellationTokenSource().token },
                            { walkMode: walkMode, editor: new Editor() }
                        ];
                        for (const options of optionsList) {
                            node.walk(() => { }, options);
                            expect(getIsActive(nodes), `${node.kind}.walk() with walkMode ${walkMode} and options ${Object.keys(options).join(',')}`).to.eql(expected);
                        }
                    }
                }
            });

            it('does not change the stored #if results when walking any subtree', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const statements = findConditionalCompiles(ast);
                const expected = statements.map(x => [x.isConditionTrue, x.isConditionDeclared]);
                for (const node of getAllNodes(ast)) {
                    node.walk(() => { }, { walkMode: everyBranchRecursive });
                    node.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                }
                expect(statements.map(x => [x.isConditionTrue, x.isConditionDeclared])).to.eql(expected);
            });

            it('follows the stored branch when the walk starts at an #if statement', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const [statement] = findConditionalCompiles(findFunction(ast, 'main'));
                const printed: string[] = [];
                statement.walk(createVisitor({
                    PrintStatement: (node) => {
                        printed.push((node.expressions[0] as LiteralExpression).tokens.value.text);
                    }
                }), { walkMode: WalkMode.visitAllRecursive });
                expect(printed).to.eql(['"a"']);
            });

            it('does not apply changed ast.bsConsts in a subtree walk, only at the next full walk', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    sub main()
                        #if MANIFEST
                            print "a"
                        #else
                            print "b"
                        #end if
                    end sub
                `);
                const a = findPrint(ast, 'a');
                const b = findPrint(ast, 'b');
                const main = findFunction(ast, 'main');
                expect([a.isActive, b.isActive]).to.eql([false, true]);

                ast.bsConsts = new Map([['manifest', true]]);
                main.walk(() => { }, { walkMode: everyBranchRecursive });
                main.func.body.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                expect([a.isActive, b.isActive]).to.eql([false, true]);

                ast.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                expect([a.isActive, b.isActive]).to.eql([true, false]);
            });

            it('sets isActive on a node inserted into an active branch when a subtree walk reaches it', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const main = findFunction(ast, 'main');
                const [statement] = findConditionalCompiles(main);
                const inserted = findPrint(ast, 'g').clone();
                expect(inserted.isActive).to.be.undefined;
                (statement.thenBranch.statements as Statement[]).push(inserted);
                main.func.body.walk(() => { }, { walkMode: WalkMode.visitStatements });
                expect(inserted.isActive).to.be.true;
                expect(inserted.expressions[0].isActive).to.be.undefined;
                main.func.body.walk(() => { }, { walkMode: WalkMode.visitAll });
                expect(inserted.expressions[0].isActive).to.be.true;
            });

            it('sets isActive on a node inserted into an inactive branch once a walk reaches that branch', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const main = findFunction(ast, 'main');
                const [statement] = findConditionalCompiles(main);
                //a node copied from active code carries its old value until a walk reaches it
                const inserted = findPrint(ast, 'g');
                const elseBlock = (statement.elseBranch as ConditionalCompileStatement).elseBranch as Block;
                (findFunction(ast, 'gamma').func.body.statements as Statement[]).splice(0, 1);
                (elseBlock.statements as Statement[]).push(inserted);
                expect(inserted.isActive).to.be.true;

                //a walk that skips the inactive branch does not reach it
                main.func.body.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                expect(inserted.isActive).to.be.true;

                main.func.body.walk(() => { }, { walkMode: everyBranchRecursive });
                expect([inserted.isActive, inserted.expressions[0].isActive]).to.eql([false, false]);

                inserted.isActive = true;
                ast.walk(() => { }, { walkMode: WalkMode.visitStatementsRecursive });
                expect(inserted.isActive).to.be.false;
            });

            it('updates isActive when a node moves from an inactive branch to an active one', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const main = findFunction(ast, 'main');
                const [statement] = findConditionalCompiles(main);
                const elseBlock = (statement.elseBranch as ConditionalCompileStatement).elseBranch as Block;
                const moved = elseBlock.statements[0] as PrintStatement;
                expect(moved.isActive).to.be.false;
                (elseBlock.statements as Statement[]).splice(0, 1);
                (statement.thenBranch.statements as Statement[]).push(moved);
                main.func.body.walk(() => { }, { walkMode: WalkMode.visitAll });
                expect([moved.isActive, moved.expressions[0].isActive]).to.eql([true, true]);
            });

            it('sets isActive on a node a visitor returns as a replacement in a subtree walk', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const main = findFunction(ast, 'main');
                const replacements = new Map<string, PrintStatement>();
                main.func.body.walk(createVisitor({
                    PrintStatement: (node) => {
                        const text = (node.expressions[0] as LiteralExpression).tokens.value.text;
                        if (!replacements.has(text)) {
                            const replacement = node.clone();
                            replacements.set(text, replacement);
                            return replacement;
                        }
                    }
                }), { walkMode: everyBranchRecursive });
                expect(
                    [...replacements].map(([text, x]) => [text, x.isActive, x.expressions[0].isActive])
                ).to.eql([
                    ['"a"', true, true],
                    ['"b"', false, false],
                    ['"c"', false, false],
                    ['"d"', false, false],
                    ['"d2"', true, true]
                ]);
            });

            it('treats the start of a walk on a detached subtree as the root', () => {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                const clone = findFunction(ast, 'inactive').clone();
                clone.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                expect(clone.func.isActive).to.be.true;
                //the cloned `#if` has no stored result yet, so it is walked as if its condition were false
                expect(findPrint(clone, 'e').isActive).to.be.false;
            });

            it('resolves a cloned file ast with the original manifest constants', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if MANIFEST
                        sub a()
                        end sub
                    #else
                        sub b()
                        end sub
                    #end if
                `);
                ast.bsConsts = new Map([['manifest', true]]);
                ast.link();
                expect(findFunction(ast, 'a').isActive).to.be.true;

                const clone = ast.clone();
                clone.link();
                expect([findFunction(clone, 'a').isActive, findFunction(clone, 'b').isActive]).to.eql([true, false]);
            });

            function testReplacedHashIf(editor?: Editor) {
                const { ast } = program.setFile<BrsFile>('source/main.bs', source);
                let replacement: ConditionalCompileStatement;
                ast.walk(createVisitor({
                    ConditionalCompileStatement: (node) => {
                        if (!replacement) {
                            replacement = node.clone();
                            return replacement;
                        }
                    }
                }), { walkMode: WalkMode.visitAllRecursive, editor: editor });
                expect(replacement.isConditionTrue).to.be.true;
                expect(findPrint(replacement, 'a').isActive).to.be.true;
                expect(findPrint(replacement, 'c').isActive).to.be.false;
            }

            it('resolves an #if a visitor returns as a replacement during a full walk', () => {
                testReplacedHashIf();
            });

            it('resolves an #if a visitor returns as a replacement during a full walk with an editor', () => {
                testReplacedHashIf(new Editor());
            });

            it('applies a #const a visitor returns as a replacement during a full walk', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #const FEATURE = true
                    #if FEATURE
                        sub a()
                        end sub
                    #end if
                `);
                ast.walk(createVisitor({
                    ConditionalCompileConstStatement: (node) => {
                        return node.clone();
                    }
                }), { walkMode: WalkMode.visitAllRecursive });
                expect(findFunction(ast, 'a').isActive).to.be.true;
            });

            it('only resolves the statements a full walk reaches before it is cancelled', () => {
                const { ast } = program.setFile<BrsFile>('source/main.brs', `
                    #if FIRST
                        sub first()
                        end sub
                    #end if
                    #if SECOND
                        sub second()
                        end sub
                    #end if
                `);
                const first = findFunction(ast, 'first');
                const second = findFunction(ast, 'second');
                expect([first.isActive, second.isActive]).to.eql([false, false]);

                ast.bsConsts = new Map([['first', true], ['second', true]]);
                //findChild walks from the root and stops at the first match
                expect(ast.findChild(isFunctionStatement)).to.equal(first);
                //like `parent`, the walk stopped before it reached the second statement, so that keeps its previous answer
                expect([first.isActive, second.isActive]).to.eql([true, false]);

                ast.walk(() => { }, { walkMode: WalkMode.visitAllRecursive });
                expect([first.isActive, second.isActive]).to.eql([true, true]);
            });
        });

        it('walks a new child when returned from a visitor and using an AstEditor', () => {
            let walkedLiterals: string[] = [];

            Parser.parse(`
                sub main()
                    print 1 + 2
                end sub
            `).ast.walk(createVisitor({
                BinaryExpression: (node, parent, owner: Statement[], key) => {
                    //replace the `1 + 2` binary expression with a new binary expression
                    if (isLiteralExpression(node.left) && node.left.tokens.value.text === '1') {
                        return new BinaryExpression({
                            left: createIntegerLiteral('3'),
                            operator: createToken(TokenKind.Plus),
                            right: createIntegerLiteral('4')
                        });
                    }
                },
                LiteralExpression: (node) => {
                    walkedLiterals.push(node.tokens.value.text);
                }
            }), {
                walkMode: WalkMode.visitAllRecursive,
                editor: new Editor()
            });

            expect(walkedLiterals).to.eql(['3', '4']);
        });
    });

    describe('walkArray', () => {
        const one = createVariableExpression('one');
        const two = createVariableExpression('two');
        const three = createVariableExpression('three');
        const four = createVariableExpression('four');
        const five = createVariableExpression('five');

        function doTest(startingArray: VariableExpression[], expected: VariableExpression[], visitor?: (item: AstNode, parent: AstNode, owner: any, key: number) => any) {
            const visitedItems: VariableExpression[] = [];
            walkArray(startingArray, (item, parent, owner, key) => {
                visitedItems.push(item as any);
                return visitor?.(item, parent, owner, key);
            }, { walkMode: WalkMode.visitAllRecursive });
            expect(
                visitedItems.map(x => x.tokens.name.text)
            ).to.eql(
                expected.map(x => x.tokens.name.text)
            );
        }

        it('walks every element in the array', () => {
            doTest(
                [one, two, three, four, five],
                [one, two, three, four, five]
            );
        });

        it('walks new items added to the array', () => {
            doTest(
                [one, two],
                [one, three, two, four],
                (item, parent, owner, key) => {
                    //insert a value after one
                    if (item === one) {
                        owner.splice(key + 1, 0, three);
                        //insert a value after one
                    } else if (item === two) {
                        owner.splice(key + 1, 0, four);
                    }
                }
            );
        });

        it('triggers on nodes that were skiped due to insertions', () => {
            doTest(
                [one, two, three],
                [one, two, four, three],
                (item, parent, owner, key) => {
                    //insert a value after one
                    if (item === two) {
                        owner.splice(key, 0, four);
                    }
                }
            );
        });
    });
});
