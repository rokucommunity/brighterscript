/* eslint no-template-curly-in-string: 0 */
import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { getTestGetTypedef, getTestTranspile, rootDir } from '../testHelpers.spec';
import { Parser, ParseMode } from './Parser';
import { TranspileState } from './TranspileState';
import { BrsTranspileState } from './BrsTranspileState';
import { TokenKind } from '../lexer/TokenKind';
import { Lexer } from '../lexer/Lexer';
import type { Token } from '../lexer/Token';
import { createIdentifier, createIntegerLiteral, createStringLiteral, createToken, createVariableExpression } from '../astUtils/creators';
import {
    AAIndexedMemberExpression,
    AAMemberExpression,
    AnnotationExpression,
    ArrayLiteralExpression,
    CallExpression,
    CallfuncExpression,
    FunctionExpression,
    FunctionParameterExpression,
    IndexedGetExpression,
    InlineInterfaceExpression,
    InlineInterfaceMemberExpression,
    RegexLiteralExpression,
    TaggedTemplateStringExpression,
    TemplateStringExpression,
    TemplateStringQuasiExpression,
    TypedArrayExpression,
    TypedFunctionTypeExpression,
    TypeExpression,
    UnaryExpression
} from './Expression';
import {
    AssignmentStatement,
    Block,
    Body,
    CatchStatement,
    ConditionalCompileStatement,
    ConstStatement,
    ContinueStatement,
    DimStatement,
    EmptyStatement,
    EnumMemberStatement,
    EnumStatement,
    ExitStatement,
    ExpressionStatement,
    FieldStatement,
    FunctionStatement,
    IfStatement,
    ImportStatement,
    IndexedSetStatement,
    InterfaceFieldStatement,
    InterfaceMethodStatement,
    LibraryStatement,
    MethodStatement,
    PrintStatement,
    TryCatchStatement,
    TypeStatement
} from './Statement';
import type { AstNode } from './AstNode';
import { isConditionalCompileStatement, isFunctionStatement, isMethodStatement, isPrintStatement } from '../astUtils/reflection';

/**
 * Covers the less common paths of every AST output method (`toSourceNode`/`toString`, `transpile`, and `getTypedef`):
 * nodes that are missing optional parts (as created by plugins or by the parser during error recovery), and
 * output methods that are normally bypassed by their parent node.
 */
describe('AST output', () => {
    let program: Program;
    let file: BrsFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);
    let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        file = program.setFile<BrsFile>('source/main.bs', '');
    });
    afterEach(() => {
        program.dispose();
    });

    /**
     * Transpile a single node and return the output code
     */
    function transpile(node: AstNode, state = new BrsTranspileState(file)) {
        return state.toSourceNode(...node.transpile(state) as any[]).toString();
    }

    /**
     * Get the typedef for a single node and return the output code
     */
    function typedef(node: AstNode, state = new BrsTranspileState(file)) {
        return state.toSourceNode(...node.getTypedef(state) as any[]).toString();
    }

    describe('toSourceNode', () => {
        it('handles empty statements and bodies', () => {
            expect(new EmptyStatement().toString()).to.eql('');
            expect(new Body().toString()).to.eql('');
            expect(new Block({ statements: undefined }).toString()).to.eql('');
        });

        it('handles functions and methods with no function expression', () => {
            expect(new FunctionStatement({ name: createIdentifier('test'), func: undefined }).toString()).to.eql('');
            expect(new MethodStatement({ name: createIdentifier('test'), func: undefined }).toString()).to.eql('');
            expect(new MethodStatement({ modifiers: createToken(TokenKind.Public), name: createIdentifier('test'), func: undefined }).toString()).to.eql('public');
        });

        it('handles functions with no function keyword', () => {
            expect(new FunctionStatement({
                name: createIdentifier('test'),
                func: new FunctionExpression({
                    leftParen: createToken(TokenKind.LeftParen),
                    rightParen: createToken(TokenKind.RightParen),
                    body: new Block({ statements: [] })
                })
            }).toString()).to.eql('test()');
        });

        it('handles unary expressions with no operator', () => {
            expect(new UnaryExpression({ operator: undefined, right: createIntegerLiteral('1') }).toString()).to.eql('1');
        });

        it('handles print statements with no expressions', () => {
            expect(new PrintStatement({ print: createToken(TokenKind.Print), expressions: undefined }).toString()).to.eql('print');
        });

        it('handles template strings with missing quasis and expressions', () => {
            expect(new TemplateStringExpression({
                openingBacktick: createToken(TokenKind.BackTick),
                quasis: undefined,
                expressions: undefined,
                closingBacktick: createToken(TokenKind.BackTick)
            }).toString()).to.eql('``');

            expect(new TaggedTemplateStringExpression({
                tagName: createIdentifier('tag'),
                openingBacktick: createToken(TokenKind.BackTick),
                quasis: [new TemplateStringQuasiExpression({ expressions: [] })],
                expressions: undefined,
                closingBacktick: createToken(TokenKind.BackTick)
            }).toString()).to.eql('tag``');
        });
    });

    describe('TranspileState helpers', () => {
        const state = new TranspileState('', {});

        it('skips empty and missing trivia', () => {
            const token = createToken(TokenKind.Identifier, 'name');
            token.leadingTrivia = [undefined, createToken(TokenKind.Whitespace, ''), createToken(TokenKind.Whitespace, ' ')];
            expect(state.tokenToSourceNodeWithTrivia(token).toString()).to.eql(' name');
        });

        it('handles missing lists', () => {
            expect(state.statementsToSourceNode(undefined).toString()).to.eql('');
            expect(state.nodesToSourceNode(undefined).toString()).to.eql('');
        });

        it('does not write a default separator before nodes that have a location or leading whitespace', () => {
            const parsed = Parser.parse('doSomething(1, 2)').ast.findChild<CallExpression>(x => x instanceof CallExpression);
            //the second node has a location
            expect(state.nodesToSourceNode(parsed.args, [], ', ').toString()).to.eql('1 2');

            //the second node has no location, but has leading whitespace
            const literal = createIntegerLiteral('2');
            literal.tokens.value.leadingTrivia = [createToken(TokenKind.Newline, '\n')];
            expect(state.nodesToSourceNode([createIntegerLiteral('1'), literal], [], ', ').toString()).to.eql('1\n2');
        });

        it('handles undefined nodes in lists', () => {
            expect(state.nodesToSourceNode([createIntegerLiteral('1'), undefined, createIntegerLiteral('2')], [], ', ').toString()).to.eql('1, , 2');
        });
    });

    describe('clone', () => {
        //nodes created by plugins don't have the new separator token arrays, so make sure clone handles that
        function testClone(node: AstNode, expected: string) {
            expect(node.toString()).to.eql(expected);
            expect(node.clone().toString()).to.eql(expected);
        }

        it('clones nodes that have no separator tokens', () => {
            const params = [new FunctionParameterExpression({ name: createIdentifier('a') }), new FunctionParameterExpression({ name: createIdentifier('b') })];
            testClone(new FunctionExpression({
                functionType: createToken(TokenKind.Sub),
                leftParen: createToken(TokenKind.LeftParen),
                parameters: params,
                rightParen: createToken(TokenKind.RightParen),
                body: new Block({ statements: [] }),
                endFunctionType: createToken(TokenKind.EndSub)
            }), 'sub(a, b)\nend sub');

            testClone(new IndexedGetExpression({
                obj: createVariableExpression('arr'),
                openingSquare: createToken(TokenKind.LeftSquareBracket),
                indexes: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                closingSquare: createToken(TokenKind.RightSquareBracket)
            }), 'arr[1, 2]');

            testClone(new ArrayLiteralExpression({
                open: createToken(TokenKind.LeftSquareBracket),
                elements: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                close: createToken(TokenKind.RightSquareBracket)
            }), '[1, 2]');

            testClone(new CallfuncExpression({
                callee: createVariableExpression('node'),
                operator: createToken(TokenKind.Callfunc),
                methodName: createIdentifier('doSomething'),
                openingParen: createToken(TokenKind.LeftParen),
                args: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                closingParen: createToken(TokenKind.RightParen)
            }), 'node@.doSomething(1, 2)');

            testClone(new InlineInterfaceExpression({
                open: createToken(TokenKind.LeftCurlyBrace),
                members: [
                    new InlineInterfaceMemberExpression({ name: createIdentifier('a') }),
                    new InlineInterfaceMemberExpression({ name: createIdentifier('b') })
                ],
                close: createToken(TokenKind.RightCurlyBrace)
            }), '{a, b}');

            testClone(new TypedFunctionTypeExpression({
                functionType: createToken(TokenKind.Function),
                leftParen: createToken(TokenKind.LeftParen),
                params: params,
                rightParen: createToken(TokenKind.RightParen)
            }), 'function(a, b)');

            testClone(new DimStatement({
                dim: createToken(TokenKind.Dim),
                name: createIdentifier('arr'),
                openingSquare: createToken(TokenKind.LeftSquareBracket),
                dimensions: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                closingSquare: createToken(TokenKind.RightSquareBracket)
            }), 'dim arr[1, 2]');

            testClone(new IndexedSetStatement({
                obj: createVariableExpression('arr'),
                openingSquare: createToken(TokenKind.LeftSquareBracket),
                indexes: [createIntegerLiteral('1'), createIntegerLiteral('2')],
                closingSquare: createToken(TokenKind.RightSquareBracket),
                equals: createToken(TokenKind.Equal),
                value: createIntegerLiteral('3')
            }), 'arr[1, 2] = 3');

            testClone(new InterfaceMethodStatement({
                functionType: createToken(TokenKind.Function),
                name: createIdentifier('test'),
                leftParen: createToken(TokenKind.LeftParen),
                params: params,
                rightParen: createToken(TokenKind.RightParen)
            }), 'function test(a, b)');

            const quasis = [
                new TemplateStringQuasiExpression({ expressions: [] }),
                new TemplateStringQuasiExpression({ expressions: [] })
            ];
            testClone(new TemplateStringExpression({
                openingBacktick: createToken(TokenKind.BackTick),
                quasis: quasis,
                expressions: [createVariableExpression('name')],
                closingBacktick: createToken(TokenKind.BackTick)
            }), '`${name}`');

            testClone(new TaggedTemplateStringExpression({
                tagName: createIdentifier('tag'),
                openingBacktick: createToken(TokenKind.BackTick),
                quasis: quasis,
                expressions: [createVariableExpression('name')],
                closingBacktick: createToken(TokenKind.BackTick)
            }), 'tag`${name}`');
        });

        it('clones annotations whose call has no args or commas', () => {
            const annotation = new AnnotationExpression({ at: createToken(TokenKind.At), name: createIdentifier('anno') });
            annotation.call = new CallExpression({
                callee: annotation,
                openingParen: createToken(TokenKind.LeftParen),
                closingParen: createToken(TokenKind.RightParen)
            });
            (annotation.call as any).args = undefined;
            testClone(annotation, '@anno()');
        });

        it('clones annotations whose call has undefined args', () => {
            const annotation = new AnnotationExpression({ at: createToken(TokenKind.At), name: createIdentifier('anno') });
            annotation.call = new CallExpression({
                callee: annotation,
                openingParen: createToken(TokenKind.LeftParen),
                args: [undefined, createIntegerLiteral('1')],
                closingParen: createToken(TokenKind.RightParen)
            });
            testClone(annotation, '@anno(, 1)');
        });
    });

    describe('parser', () => {
        it('keeps tokens from a `#else` block whose errors were discarded', () => {
            const text = `
                sub main()
                    #if true
                        print "debug"
                    #else
                        this is not valid code
                    #end if
                end sub
            `;
            const parser = Parser.parse(text);
            expect(parser.diagnostics).to.be.empty;
            expect(parser.ast.toString()).to.eql(text);
        });

        it('handles `#error` with no message', () => {
            const parser = Parser.parse(`#error\nprint "hello"`);
            expect(parser.ast.toString()).to.eql(`#error\nprint "hello"`);
        });

        it('keeps tokens from an unterminated `#if` block', () => {
            const text = `sub main()\n    #if true\n        print "hello"\n`;
            const parser = Parser.parse(text);
            expect(parser.diagnostics).not.to.be.empty;
            expect(parser.ast.toString()).to.eql(text);
        });

        it('joins `#error` messages made from multiple tokens', () => {
            //the lexer always produces a single message token, but plugins can pass their own tokens to the parser
            const tokens = Lexer.scan(`#error\n`).tokens;
            tokens.splice(1, 0, createToken(TokenKind.Identifier, 'some'), createToken(TokenKind.Identifier, 'message'));
            const parser = Parser.parse(tokens);
            expect((parser.ast.statements[0] as any).tokens.message.text).to.eql('some message');
        });

        it('handles derived tokens when not tracking locations', () => {
            const parser = Parser.parse(`sub main()\n    print\nend sub\nclass Person\n    public getName()\n    end function\nend class`, { mode: ParseMode.BrighterScript, trackLocations: false });
            const print = parser.ast.findChild<PrintStatement>(isPrintStatement);
            expect(print.expressions[0].location).to.be.undefined;
            const method = parser.ast.findChild<MethodStatement>(isMethodStatement);
            expect(method.func.tokens.functionType.location).to.be.undefined;
        });

        it('handles colons that are not in the leading trivia of the next token', () => {
            //plugins can pass tokens directly to the parser, and those might not have any trivia
            const tokens = Lexer.scan(`x = {a:1}`).tokens.map(x => ({ ...x, leadingTrivia: undefined } as Token));
            const parser = Parser.parse(tokens);
            expect(parser.diagnostics).to.be.empty;
            expect(parser.ast.toString()).to.eql(`x={a:1}`);
        });
    });

    describe('transpile', () => {
        it('transpiles SOURCE_NAMESPACE_NAME and SOURCE_NAMESPACE_ROOT_NAME', async () => {
            await testTranspile(`
                namespace alpha.beta
                    sub test()
                        print SOURCE_NAMESPACE_NAME
                        print SOURCE_NAMESPACE_ROOT_NAME
                    end sub
                end namespace
                sub noNamespace()
                    print SOURCE_NAMESPACE_NAME
                    print SOURCE_NAMESPACE_ROOT_NAME
                end sub
            `, `
                sub alpha_beta_test()
                    print "alpha.beta"
                    print "alpha"
                end sub

                sub noNamespace()
                    print ""
                    print ""
                end sub
            `);
        });

        it('transpiles `continue` outside of a loop when the firmware does not support `continue`', async () => {
            program.options.minFirmwareVersion = '11.0.0';
            await testTranspile(`
                sub main()
                    continue for
                end sub
            `, `
                sub main()
                    continue for
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('does not transpile unexpected characters', async () => {
            await testTranspile(`
                sub main()
                    print "hello" |
                end sub
            `, `
                sub main()
                    print "hello"
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('transpiles a `library` statement with no path', async () => {
            await testTranspile(`library`, `library`, 'trim', 'source/main.brs', false);
        });

        it('transpiles a ternary with a missing consequent and alternate', () => {
            const parser = Parser.parse(`x = m.a ? : `, { mode: ParseMode.BrighterScript });
            const assignment = parser.ast.statements[0] as AssignmentStatement;
            (assignment.value as any).alternate = undefined;
            (assignment.value as any).consequent = undefined;
            expect(transpile(assignment.value)).to.eql(`bslib_ternary(m.a, invalid, invalid)`);
        });

        it('transpiles output methods that are normally bypassed by their parent', () => {
            expect(transpile(new AAMemberExpression({ key: createIdentifier('a'), colon: createToken(TokenKind.Colon), value: createIntegerLiteral('1') }))).to.eql('');
            expect(transpile(new AAIndexedMemberExpression({ key: createIntegerLiteral('1'), colon: createToken(TokenKind.Colon), value: createIntegerLiteral('1') }))).to.eql('');
            expect(transpile(new EnumMemberStatement({ name: createIdentifier('up') }))).to.eql('');
            expect(typedef(new ExpressionStatement({ expression: createVariableExpression('a') }))).to.eql('');
            expect(transpile(new TypedArrayExpression({ innerType: createVariableExpression('integer') }))).to.eql('dynamic');
            //detached from any symbol table, so the type can't be resolved
            expect(transpile(new InlineInterfaceExpression({ members: [new InlineInterfaceMemberExpression({ name: createIdentifier('a'), as: createToken(TokenKind.As), typeExpression: new TypeExpression({ expression: createVariableExpression('integer') }) })] }))).to.eql('dynamic');
            expect(transpile(new TypedFunctionTypeExpression({ functionType: createToken(TokenKind.Function), params: [] }))).to.eql('Function');
            expect(typedef(new LibraryStatement({ library: createToken(TokenKind.Library), filePath: createStringLiteral('lib.brs').tokens.value }))).to.eql('library "lib.brs"');
        });

        it('throws for nodes that cannot be transpiled on their own', () => {
            expect(() => new InlineInterfaceMemberExpression({ name: createIdentifier('a') }).transpile(new BrsTranspileState(file))).to.throw();
            expect(() => new InterfaceFieldStatement({ name: createIdentifier('a') }).transpile(new BrsTranspileState(file))).to.throw();
            expect(() => new InterfaceMethodStatement({ name: createIdentifier('a') }).transpile(new BrsTranspileState(file))).to.throw();
            expect(() => new FieldStatement({ name: createIdentifier('a') }).transpile(new BrsTranspileState(file))).to.throw();
        });

        it('transpiles nodes that are missing optional tokens', () => {
            expect(transpile(new AssignmentStatement({ name: createIdentifier('a'), value: createIntegerLiteral('1') }))).to.eql('a = 1');
            expect(transpile(new ExitStatement({ loopType: undefined }))).to.eql('exit ');
            expect(transpile(new ContinueStatement({ loopType: createToken(TokenKind.For) }))).to.eql('continue for');
            expect(transpile(new RegexLiteralExpression({ regexLiteral: undefined }))).to.eql('CreateObject("roRegex", "", "")');
            expect(transpile(new IndexedGetExpression({ obj: createVariableExpression('a'), indexes: [undefined] }))).to.eql('a[]');
            expect(transpile(new IndexedSetStatement({ obj: createVariableExpression('a'), indexes: [undefined], value: createIntegerLiteral('1') }))).to.eql('a[] = 1');
            expect(transpile(new CallfuncExpression({ callee: createVariableExpression('node'), methodName: createIdentifier('test') }))).to.eql('node.callfunc("test")');
            (file as any).parser.ast.statements.push(new FunctionStatement({
                name: createIdentifier('main'),
                func: new FunctionExpression({
                    body: new Block({
                        statements: [new TryCatchStatement({ tryBranch: new Block({ statements: [] }) })]
                    })
                })
            }));
            file.ast.link();
            const tryCatch = file.ast.findChild<TryCatchStatement>(x => x instanceof TryCatchStatement);
            expect(transpile(tryCatch)).to.eql('try\ncatch\nend try');
            const catchStatement = new CatchStatement({});
            (tryCatch as any).catchStatement = catchStatement;
            catchStatement.parent = tryCatch;
            expect(transpile(catchStatement)).to.eql('catch e');
        });


        it('transpiles functions that are missing optional parts', () => {
            const func = new FunctionExpression({
                functionType: createToken(TokenKind.Sub),
                leftParen: createToken(TokenKind.LeftParen),
                rightParen: createToken(TokenKind.RightParen),
                body: new Block({ statements: [] })
            });
            //no end token, so it's derived from the function type
            expect(transpile(func)).to.eql('sub()\nend sub');
            expect(typedef(func)).to.eql('sub()\nend sub');
            //without the body
            const state = new BrsTranspileState(file);
            expect(state.toSourceNode(...func.transpile(state, undefined, false) as any[]).toString()).to.eql('sub()\nend sub');
            //no parameters at all
            (func as any).parameters = undefined;
            expect(typedef(func)).to.eql('sub()\nend sub');
            //parent function statement with no name
            const statement = new FunctionStatement({ name: undefined, func: func });
            func.parent = statement;
            expect(typedef(func)).to.eql('sub ()\nend sub');
        });

        it('transpiles ternaries with a missing consequent or alternate that need a scope-capturing function', () => {
            const parser = Parser.parse(`x = m.a ? m.b() : m.c()`, { mode: ParseMode.BrighterScript });
            const ternary = (parser.ast.statements[0] as AssignmentStatement).value as any;
            const consequent = ternary.consequent;
            ternary.consequent = undefined;
            expect(transpile(ternary)).to.include('return invalid\n');
            ternary.consequent = consequent;
            ternary.alternate = undefined;
            expect(transpile(ternary)).to.include('return invalid\n');
        });

        it('transpiles function statements whose leading comment has no location', () => {
            const parser = Parser.parse(`sub a()\nend sub\nsub b()\nend sub`);
            const second = parser.ast.statements[1] as FunctionStatement;
            second.func.tokens.functionType.leadingTrivia = [createToken(TokenKind.Comment, `'comment`), createToken(TokenKind.Newline, '\n')];
            //the comment has no location, so it can't be on the same line as the previous statement
            expect(transpile(parser.ast)).to.eql(`sub a()\nend sub\n'comment\nsub b()\nend sub`);
        });

        it('transpiles print statements whose first expression has no leading trivia', () => {
            const print = new PrintStatement({
                print: createToken(TokenKind.Print),
                expressions: [new FunctionExpression({ leftParen: createToken(TokenKind.LeftParen), rightParen: createToken(TokenKind.RightParen), body: new Block({ statements: [] }) })]
            });
            expect(transpile(print)).to.eql('print function()\nend function');
        });

        it('transpiles library statements with no path, and detached catch statements', () => {
            expect(transpile(new LibraryStatement({ library: createToken(TokenKind.Library) }))).to.eql('library');
            expect(transpile(new CatchStatement({ catch: createToken(TokenKind.Catch) }))).to.eql('catch e');
        });

        it('transpiles callfunc expressions with no args array', () => {
            const callfunc = new CallfuncExpression({ callee: createVariableExpression('node'), methodName: createIdentifier('test') });
            (callfunc as any).args = undefined;
            expect(transpile(callfunc)).to.eql('node.callfunc("test")');

            const ifStatement = new IfStatement({
                condition: createVariableExpression('a'),
                thenBranch: new Block({ statements: [] })
            });
            expect(transpile(ifStatement)).to.eql('if a\nend if');
        });

        it('transpiles conditional compile statements that are missing optional tokens', () => {
            const statement = new ConditionalCompileStatement({
                condition: createToken(TokenKind.Identifier, 'debug'),
                thenBranch: new Block({ statements: [] }),
                elseBranch: new ConditionalCompileStatement({
                    condition: createToken(TokenKind.Identifier, 'other'),
                    thenBranch: new Block({ statements: [] }),
                    elseBranch: new Block({ statements: [] })
                })
            });
            expect(transpile(statement)).to.eql('#if debug\n#else if other\n#else\n#end if');
        });

        it('transpiles conditional compile statements with no else branch', () => {
            const parser = Parser.parse(`sub main()\n    #if debug\n        print "debug"\n    #end if\nend sub`);
            const statement = parser.ast.findChild<ConditionalCompileStatement>(isConditionalCompileStatement);
            expect(transpile(statement)).to.eql(`#if debug\n    print "debug"\n#end if`);
        });

        it('transpiles blocks that are transpiled on their own', () => {
            const parser = Parser.parse(`sub main()\n    print "hello"\nend sub`);
            const func = parser.ast.findChild<FunctionStatement>(isFunctionStatement);
            expect(transpile(func.func.body)).to.eql(`\n    print "hello"`);
        });

        it('keeps comments above method modifiers', async () => {
            await testTranspile(`
                class Movie
                    'above public
                    public sub play()
                    end sub
                end class
            `, `
                sub __Movie_method_new()
                end sub
                'above public
                sub __Movie_method_play()
                end sub
                function __Movie_builder()
                    instance = {}
                    instance.new = __Movie_method_new
                    'above public
                    instance.play = __Movie_method_play
                    return instance
                end function
                function Movie()
                    instance = __Movie_builder()
                    instance.new()
                    return instance
                end function
            `);
        });

        it('transpiles super calls on non-variable expressions in class methods', async () => {
            program.setFile('source/main.bs', `
                class Animal
                    function getName()
                        return "a"
                    end function
                end class
                class Dog extends Animal
                    override function getName()
                        return getThing().name + super.getName()
                    end function
                end class
                function getThing()
                    return {}
                end function
            `);
            program.validate();
            expect(program.getDiagnostics()).to.be.empty;
            const result = await program.getTranspiledFileContents(file.srcPath);
            expect(result.code).to.include('return getThing().name + m.super0_getName()');
        });
    });

    describe('getTypedef', () => {
        it('includes leading comments', async () => {
            await testGetTypedef(`
                'namespace comment
                namespace alpha
                    'class comment
                    class Movie extends Base
                        'field comment
                        optional name as string
                        'method comment
                        sub new()
                            super()
                        end sub
                    end class
                    class Base
                    end class
                end namespace
                'interface comment
                interface IMovie
                    'field comment
                    optional name as string
                    untyped
                    'method comment
                    optional function getName(a, b as string) as string
                    sub noReturn()
                end interface
                'enum comment
                enum Direction
                    'member comment
                    up = "up"
                    down = "down"
                end enum
                'const comment
                const A = 1
                'type comment
                type T = string
            `, `
                'namespace comment
                namespace alpha
                    'class comment
                    class Movie extends alpha.Base
                        'field comment
                        public optional name as string
                        'method comment
                        sub new()
                        end sub
                    end class
                    class Base
                        sub new()
                        end sub
                    end class
                end namespace
                'interface comment
                interface IMovie
                    'field comment
                    optional name as string
                    untyped
                    'method comment
                    optional function getName(a, b as string) as string
                    sub noReturn()
                end interface

                'enum comment
                enum Direction
                    'member comment
                    up = "up"
                    down = "down"
                end enum
                'const comment
                const A = 1
                'type comment
                type T = string
            `);
        });

        it('includes annotations', async () => {
            await testGetTypedef(`
                @classAnnotation
                class Movie
                    @fieldAnnotation
                    name as string
                end class
                @interfaceAnnotation
                interface IMovie
                    @fieldAnnotation
                    name as string
                    @methodAnnotation
                    function getName() as string
                end interface
                @enumAnnotation
                enum Direction
                    up
                end enum
            `, `
                @classAnnotation
                class Movie
                    sub new()
                    end sub
                    @fieldAnnotation
                    public name as string
                end class
                @interfaceAnnotation
                interface IMovie
                    @fieldAnnotation
                    name as string
                    @methodAnnotation
                    function getName() as string
                end interface

                @enumAnnotation
                enum Direction
                    up
                end enum
            `);
        });

        it('keeps comments above and below annotations in source order', async () => {
            await testGetTypedef(`
                'above function annotation
                @anno
                'between function annotation
                sub test()
                end sub
                'above class annotation
                @anno
                'between class annotation
                class Movie extends Base
                    'above field annotation
                    @anno
                    'between field annotation
                    public name as string
                    'above method annotation
                    @anno
                    'between method annotation
                    override sub stop()
                    end sub
                end class
                class Base
                    sub stop()
                    end sub
                end class
                'above interface annotation
                @anno
                interface IMovie
                    'above field annotation
                    @anno
                    name as string
                    'above method annotation
                    @anno
                    function getName() as string
                end interface
                'above enum annotation
                @anno
                enum Direction
                    'above member annotation
                    @anno
                    up
                end enum
                'above namespace annotation
                @anno
                namespace alpha
                    'above const annotation
                    @anno
                    const A = 1
                    'above type annotation
                    @anno
                    type T = string
                end namespace
            `, `
                'above function annotation
                @anno
                'between function annotation
                sub test()
                end sub
                'above class annotation
                @anno
                'between class annotation
                class Movie extends Base
                    sub new()
                    end sub
                    'above field annotation
                    @anno
                    'between field annotation
                    public name as string
                    'above method annotation
                    @anno
                    'between method annotation
                    override sub stop()
                    end sub
                end class
                class Base
                    sub new()
                    end sub
                    sub stop()
                    end sub
                end class
                'above interface annotation
                @anno
                interface IMovie
                    'above field annotation
                    @anno
                    name as string
                    'above method annotation
                    @anno
                    function getName() as string
                end interface

                'above enum annotation
                @anno
                enum Direction
                    'above member annotation
                    up
                end enum
                'above namespace annotation
                namespace alpha
                    'above const annotation
                    const A = 1
                    'above type annotation
                    type T = string
                end namespace
            `);
        });

        it('keeps comments above method modifiers', async () => {
            await testGetTypedef(`
                class Movie extends Base
                    'above public
                    public sub play()
                    end sub
                    'above override
                    override sub stop()
                    end sub
                end class
                class Base
                    sub stop()
                    end sub
                end class
            `, `
                class Movie extends Base
                    sub new()
                    end sub
                    'above public
                    public sub play()
                    end sub
                    'above override
                    override sub stop()
                    end sub
                end class
                class Base
                    sub new()
                    end sub
                    sub stop()
                    end sub
                end class
            `);
        });

        it('handles leading trivia and modifiers created by plugins', () => {
            const state = new BrsTranspileState(file);
            const statement = new ExpressionStatement({ expression: createVariableExpression('a') });
            (statement.expression as any).tokens.name.leadingTrivia = [undefined, createToken(TokenKind.Comment, `'comment`)];
            expect(state.toSourceNode(...state.getTypedefLeadingCommentsAndAnnotations(statement) as any[]).toString()).to.eql(`'comment\n`);

            //no modifiers and no function
            expect(new MethodStatement({ name: createIdentifier('test'), func: undefined }).leadingTrivia).to.be.undefined;

            //modifiers without locations
            const publicToken = createToken(TokenKind.Public);
            publicToken.leadingTrivia = [createToken(TokenKind.Comment, `'comment`), createToken(TokenKind.Newline, '\n')];
            const method = new MethodStatement({
                modifiers: [publicToken],
                override: createToken(TokenKind.Override),
                name: createIdentifier('test'),
                func: new FunctionExpression({
                    functionType: createToken(TokenKind.Sub),
                    leftParen: createToken(TokenKind.LeftParen),
                    rightParen: createToken(TokenKind.RightParen),
                    body: new Block({ statements: [] }),
                    endFunctionType: createToken(TokenKind.EndSub)
                })
            });
            expect(method.leadingTrivia).to.equal(publicToken.leadingTrivia);
            expect(method.toString()).to.eql(`'comment\npublic override sub test()\nend sub`);
        });

        it('uses dynamic for fields whose type cannot be used in a typedef', async () => {
            await testGetTypedef(`
                class Movie
                    name = invalid
                end class
            `, `
                class Movie
                    sub new()
                    end sub
                    public name as dynamic
                end class
            `);
        });

        it('includes interface parents, and handles empty interfaces and non-member statements', async () => {
            await testGetTypedef(`
                interface IBase
                end interface
                interface IMovie extends IBase
                    name as string
                end interface
            `, `
                interface IBase
                end interface

                interface IMovie extends IBase
                    name as string
                end interface
            `);
            const iface = Parser.parse(`interface IMovie\nend interface`, { mode: ParseMode.BrighterScript }).ast.statements[0] as any;
            iface.body.push(new ExpressionStatement({ expression: createVariableExpression('a') }));
            expect(typedef(iface)).to.eql('interface IMovie\n    a\nend interface\n');
        });

        it('uses dynamic for void fields', async () => {
            await testGetTypedef(`
                class Movie
                    name as void
                end class
            `, `
                class Movie
                    sub new()
                    end sub
                    public name as dynamic
                end class
            `);
        });

        it('handles const and type statements that are missing optional tokens', () => {
            expect(typedef(new ConstStatement({ name: createIdentifier('A'), value: createIntegerLiteral('1') }))).to.eql('const A = 1');
            expect(typedef(new TypeStatement({ name: createIdentifier('T'), value: new TypeExpression({ expression: createVariableExpression('string') }) }))).to.eql('type T = string');

            const member = new EnumMemberStatement({ name: createIdentifier('up'), equals: createToken(TokenKind.Equal) });
            expect(typedef(member)).to.eql('up = ');
        });

        it('handles nodes that are missing optional tokens', () => {
            expect(typedef(new FieldStatement({ name: undefined }))).to.eql('');
            expect(typedef(new ImportStatement({ path: createStringLiteral('lib.bs').tokens.value }))).to.eql('import "lib.brs"');
            expect(typedef(new EnumStatement({ name: createIdentifier('Direction'), body: [] }))).to.eql('enum Direction\nend enum');
            expect(typedef(new FunctionParameterExpression({ name: createIdentifier('a'), as: createToken(TokenKind.As) }))).to.eql('a as ');
            expect(typedef(new FunctionExpression({ body: new Block({ statements: [] }), returnTypeExpression: new TypeExpression({ expression: createVariableExpression('integer') }) }))).to.eql('function() as integer\nend function');
            expect(typedef(new InterfaceMethodStatement({ name: createIdentifier('test'), params: undefined }))).to.eql('function test()');
        });
    });
});

