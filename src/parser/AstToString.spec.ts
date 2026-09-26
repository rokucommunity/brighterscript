/* eslint no-template-curly-in-string: 0 */
import { expect } from '../chai-config.spec';
import { Parser, ParseMode } from './Parser';
import { isAAMemberExpression, isArrayLiteralExpression, isAssignmentStatement, isCallExpression, isCallfuncExpression, isDimStatement, isExitStatement, isFunctionStatement, isIndexedGetExpression, isIndexedSetStatement, isLiteralExpression, isTemplateStringExpression, isTernaryExpression } from '../astUtils/reflection';
import type { AssignmentStatement, ConditionalCompileErrorStatement, DimStatement, ExitStatement, FunctionStatement, IndexedSetStatement } from './Statement';
import type { AAMemberExpression, ArrayLiteralExpression, CallExpression, CallfuncExpression, IndexedGetExpression, LiteralExpression, TemplateStringExpression, TernaryExpression } from './Expression';
import { createIntegerLiteral, createStringLiteral, createToken } from '../astUtils/creators';
import { Lexer } from '../lexer/Lexer';
import { TranspileState } from './TranspileState';
import { util } from '../util';
import { TokenKind } from '../lexer/TokenKind';
import { PrintStatement } from './Statement';
import type { Body } from './Statement';

describe('AST toString', () => {
    /**
     * Parse the text, and verify that converting the AST back to a string produces the exact same text.
     * Also verifies the same for a clone of the AST
     */
    function testRoundTrip(text: string, mode: ParseMode = ParseMode.BrighterScript, allowDiagnostics = false) {
        const parser = Parser.parse(text, { mode: mode });
        if (!allowDiagnostics) {
            expect(parser.diagnostics.map(x => x.message)).to.eql([]);
        }
        expect(parser.ast.toString()).to.eql(text);
        expect(parser.ast.clone().toString()).to.eql(text);
    }

    it('handles empty files', () => {
        testRoundTrip(``);
        testRoundTrip(`\n\n  \n`);
        testRoundTrip(`'just a comment`);
    });

    it('handles windows line endings', () => {
        testRoundTrip(`sub main()\r\n    print "hello"\r\nend sub\r\n`);
    });

    it('handles tabs and irregular whitespace', () => {
        testRoundTrip(`sub   main (  a ,b )\n\tprint   a;b\n\t\tx  =  ( a  +b )\nend   sub`);
    });

    it('handles trailing trivia at the end of the file', () => {
        testRoundTrip(`
            sub main()
            end sub
            'trailing comment

        `);
    });

    it('handles code without a trailing newline', () => {
        testRoundTrip(`sub main()\nend sub`);
    });

    it('handles uppercase keywords', () => {
        testRoundTrip(`
            SUB MAIN()
                IF TRUE THEN
                    PRINT "HELLO"
                END IF
            END SUB
        `, ParseMode.BrightScript);
    });

    describe('UnaryExpression', () => {
        it('preserves spacing for unary minus', () => {
            testRoundTrip(`
                sub test()
                    x = -5
                    y = -foo
                    z = -  5
                    w = +5
                end sub
            `);
        });

        it('handles `not`', () => {
            testRoundTrip(`
                sub test()
                    result = not true
                    result = not  true
                    result = not(true)
                    x = not not true
                end sub
            `);
        });

        it('handles consecutive unary operators', () => {
            testRoundTrip(`
                sub test()
                    x = - - -5
                    x = -+-5
                end sub
            `);
        });

        it('handles unary within other expressions', () => {
            testRoundTrip(`
                sub test()
                    result = -x + 10
                    foo(-5, not bar)
                    x = -(5 + 3)
                    if not (result > 0)
                        result = 0
                    end if
                end sub
            `);
        });
    });

    describe('BinaryExpression', () => {
        it('preserves whitespace around operators', () => {
            testRoundTrip(`
                sub test()
                    x = 1+2
                    y = 3  +  4
                    result = 1 + 2 * 3 - 4 / 5 \\ 6 mod 7 ^ 8
                    z = a << 1 >> 2
                    b = a and b or c
                    c = a = b
                    d = a <> b
                    e = a < b or a <= b or a > b or a >= b
                end sub
            `);
        });

        it('handles multi-line expressions', () => {
            testRoundTrip(`
                sub test()
                    x = 1 +
                        2 +
                        3
                end sub
            `);
        });
    });

    describe('comments and trivia', () => {
        it('preserves comments in all the places', () => {
            testRoundTrip(`
                'comment 1
                rem comment 2
                REM comment 3
                sub test() 'after sub
                    'this is a comment
                    x = 5 'inline comment

                    'before if
                    if true then 'after then
                        'inside if
                    else 'after else
                        'inside else
                    end if 'after end if
                    'before end sub
                end sub 'after end sub
                'end of file
            `);
        });

        it('preserves blank lines', () => {
            testRoundTrip(`

                sub test()

                    x = 1


                    y = 2

                end sub


            `);
        });

        it('preserves colon statement separators', () => {
            testRoundTrip(`
                sub test()
                    x = 1: y = 2 : z = 3
                    print "a"::print "b"
                end sub
            `);
        });
    });

    describe('functions', () => {
        it('preserves function declarations', () => {
            testRoundTrip(`
                function add(a, b)
                    return a + b
                end function
                function add(a as integer, b as integer) as integer
                    return a + b
                end function
                function greet(name = "World", count = 1 as integer)
                    return "Hello, " + name
                end function
                sub test()
                end sub
                sub test2( )
                end sub
                function noParens() as void
                end function
            `);
        });

        it('preserves anonymous functions', () => {
            testRoundTrip(`
                sub test()
                    callback = function(a, b)
                        return a + b
                    end function
                    doSomething(sub()
                        print "done"
                    end sub)
                    result = (function(x)
                        return x
                    end function)(1)
                end sub
            `);
        });

        it('preserves return statements', () => {
            testRoundTrip(`
                function test()
                    return
                end function
                function test2()
                    return 1 + 2
                end function
            `);
        });
    });

    describe('literals', () => {
        it('preserves all literal types', () => {
            testRoundTrip(`
                sub test()
                    a = "hello world"
                    b = ""
                    c = "with ""escaped"" quotes"
                    d = 42
                    e = 3.14
                    f = &hFF
                    g = &HFF&
                    h = 1.5e10
                    i = 2.5#
                    j = 1!
                    k = 99999999999&
                    l = true
                    m = false
                    n = invalid
                end sub
            `);
        });

        it('preserves array literals', () => {
            testRoundTrip(`
                sub test()
                    a = [1, 2, 3]
                    b = []
                    c = [ ]
                    d = [1,2 ,  3]
                    e = [
                        1,
                        2
                        3
                    ]
                    f = [
                        'comment
                        1 'comment
                        'comment
                        2,
                    ]
                    g = [[1, 2], [3, [4]]]
                end sub
            `);
        });

        it('preserves AA literals', () => {
            testRoundTrip(`
                sub test()
                    a = {}
                    b = { }
                    c = { name: "test", value: 42 }
                    d = {name:"test",value : 42,}
                    e = {
                        'comment
                        name: "test" 'comment
                        "quoted key": 1,
                        nested: {
                            value: [1, 2, 3]
                        }
                        'comment
                    }
                    f = { a: 1 : b: 2 }
                end sub
            `);
        });

        it('preserves computed AA keys', () => {
            testRoundTrip(`
                sub test()
                    a = { [key]: 1, ["other" + "key"] : 2 }
                end sub
            `);
        });

        it('preserves source literals', () => {
            testRoundTrip(`
                sub test()
                    print LINE_NUM
                    print SOURCE_FILE_PATH
                    print SOURCE_LINE_NUM
                    print FUNCTION_NAME
                    print SOURCE_FUNCTION_NAME
                    print SOURCE_LOCATION
                    print PKG_PATH
                    print PKG_LOCATION
                end sub
            `);
        });

        it('preserves regex literals', () => {
            testRoundTrip(`
                sub test()
                    print /123/gi
                    print /a\\/b/
                end sub
            `);
        });
    });

    describe('template strings', () => {
        it('preserves template strings', () => {
            testRoundTrip(`
                sub test()
                    a = \`hello world\`
                    b = \`\`
                    c = \`hello \${name}\`
                    d = \`\${first} \${last}\`
                    e = \`\${ first + "x" }\${last}\`
                    f = \`multi
                        line \${value}
                        string\`
                    g = \`escaped \\\` backtick and \\n newline\`
                    h = \`nested \${\`inner \${value}\`}\`
                end sub
            `);
        });

        it('preserves tagged template strings', () => {
            testRoundTrip(`
                sub test()
                    a = tag\`hello \${name} and \${other}\`
                    b = tag\`\`
                end sub
            `);
        });
    });

    describe('control flow', () => {
        it('preserves if statements', () => {
            testRoundTrip(`
                sub test()
                    if true
                        print "yes"
                    end if
                    if true then
                        print "yes"
                    else
                        print "no"
                    end if
                    if x = 1
                        print "one"
                    else if x = 2 then
                        print "two"
                    elseif x = 3
                        print "three"
                    else
                        print "other"
                    endif
                end sub
            `);
        });

        it('preserves inline if statements', () => {
            testRoundTrip(`
                sub test()
                    if true then print "yes"
                    if true then print "yes" else print "no"
                    if true then x = 1 : y = 2 else x = 2
                    if true then print "a" else if false then print "b" else print "c"
                    if true print "no then"
                end sub
            `, ParseMode.BrightScript);
        });

        it('preserves for loops', () => {
            testRoundTrip(`
                sub test()
                    for i = 0 to 10 step 1
                        print i
                    end for
                    for i = 10 to 0 step -1
                        exit for
                    next
                    for i=0 to 10
                        continue for
                    endfor
                end sub
            `);
        });

        it('preserves for each loops', () => {
            testRoundTrip(`
                sub test()
                    for each item in items
                        print item
                    end for
                    for each item as string in items
                        print item
                    next
                end sub
            `);
        });

        it('preserves while loops', () => {
            testRoundTrip(`
                sub test()
                    while true
                        exit while
                        exitwhile
                        continue while
                    end while
                    while   x < 10
                    endwhile
                end sub
            `);
        });

        it('preserves try/catch/throw', () => {
            testRoundTrip(`
                sub test()
                    try
                        throw "crash"
                    catch e
                        print e
                    end try
                    try
                    catch
                    endtry
                end sub
            `);
        });

        it('preserves goto, labels, end, and stop', () => {
            testRoundTrip(`
                sub test()
                    label1:
                    goto label1
                    stop
                    end
                end sub
            `);
        });
    });

    describe('statements', () => {
        it('preserves print statements', () => {
            testRoundTrip(`
                sub test()
                    print
                    print "a"
                    print "a"; "b", "c"
                    print "a";"b";
                    print "a" "b"
                    ? "question"
                    ?
                    print tab(5) pos(0)
                end sub
            `);
        });

        it('preserves assignments', () => {
            testRoundTrip(`
                sub test()
                    a = 1
                    a += 1
                    a -= 1
                    a *= 2
                    a /= 2
                    a \\= 2
                    a <<= 1
                    a >>= 1
                    a++
                    a--
                    m.a = 1
                    m.a.b += 1
                    m["a"] = 1
                    m.["a"] = 1
                    m[1, 2] = 3
                    m[1] += 1
                    x as integer = 1
                end sub
            `);
        });

        it('preserves dim statements', () => {
            testRoundTrip(`
                sub test()
                    dim a[5]
                    dim b[1, 2 ,3]
                end sub
            `);
        });

        it('preserves library and import statements', () => {
            testRoundTrip(`
                library "v30/bslCore.brs"
                import "pkg:/source/lib.bs"
                import ""
            `);
        });

        it('preserves conditional compile statements', () => {
            testRoundTrip(`
                #const debug = true
                #const other = debug
                sub test()
                    #if debug
                        print "debug"
                    #else if other
                        print "other"
                    #elseif not debug
                        print "not debug"
                    #else
                        print "else"
                    #end if
                    #if false
                        this is not valid code, but should not produce errors
                    #endif
                    #error this is a message
                end sub
            `);
        });

        it('preserves const statements', () => {
            testRoundTrip(`
                const A = 1
                const B="b"
                namespace alpha
                    const C = [1, 2]
                end namespace
            `);
        });

        it('preserves alias and type statements', () => {
            testRoundTrip(`
                alias l = lib.utils
                type MyType = string or integer
                type Other = { name as string }
            `);
        });

        it('preserves typecast statements', () => {
            testRoundTrip(`
                sub test()
                    typecast m as MyType
                end sub
            `);
        });
    });

    describe('expressions', () => {
        it('preserves call expressions', () => {
            testRoundTrip(`
                sub test()
                    doSomething()
                    add(1, 2, 3)
                    add( 1 ,2 )
                    obj.method1().method2()
                    obj?.method()
                    obj.method?()
                    multiLine(
                        1,
                        2
                    )
                end sub
            `);
        });

        it('preserves dotted and indexed access', () => {
            testRoundTrip(`
                sub test()
                    x = obj.prop.nested
                    x = arr[0]
                    x = arr[0][1]
                    x = arr[1, 2]
                    x = obj?.prop
                    x = arr?[0]
                    x = arr?.[0]
                    x = obj.[0]
                    x = xml@attr
                    x = xml?@attr
                end sub
            `);
        });

        it('preserves callfunc expressions', () => {
            testRoundTrip(`
                sub test()
                    m.node@.someCallfunc()
                    m.node@.someCallfunc(1, 2)
                    m.node@.someCallfunc( 1 ,2 )
                end sub
            `);
        });

        it('preserves new expressions', () => {
            testRoundTrip(`
                sub test()
                    a = new Person()
                    b = new alpha.beta.Person(1, "two")
                end sub
            `);
        });

        it('preserves ternary and null coalescing expressions', () => {
            testRoundTrip(`
                sub test()
                    a = true ? 1 : 2
                    b = true?1:2
                    c = true ? { a: 1 } : { b: 2 }
                    d = a ?? b
                    e = a??b ?? c
                    f = true ? (false ? 1 : 2) : 3
                end sub
            `);
        });

        it('preserves grouping expressions', () => {
            testRoundTrip(`
                sub test()
                    a = (1 + 2) * 3
                    b = ( ( 1 ) )
                end sub
            `);
        });

        it('preserves typecast expressions', () => {
            testRoundTrip(`
                sub test()
                    a = b as string
                    c = (d as integer) + 1
                    e = f as dynamic as string
                end sub
            `);
        });
    });

    describe('types', () => {
        it('preserves complex type expressions', () => {
            testRoundTrip(`
                function test(a as string or integer, b as Person and Employee, c as integer[], d as string[][], e as (string or integer)[]) as void
                end function
                function inline(a as { name as string, age as integer }, b as {
                    optional name as string
                    "quoted key" as integer
                }) as { result as boolean }
                end function
                function typedFunctions(callback as function(string, integer) as boolean, other as sub(a as string)) as function() as void
                end function
            `);
        });
    });

    describe('classes', () => {
        it('preserves classes', () => {
            testRoundTrip(`
                class Movie
                end class
                class Video extends Movie
                    title as string
                    duration = 5
                    public name = "x" as string
                    private secret as integer
                    protected thing
                    optional maybe as string
                    public optional other as string

                    sub new()
                        super()
                    end sub

                    public override function play() as boolean
                        return true
                    end function

                    override sub stop()
                    end sub

                    private function hidden()
                    end function
                end class
                class Namespaced extends alpha.beta.Movie
                end class
            `);
        });

        it('preserves conditional compile blocks in classes', () => {
            testRoundTrip(`
                #const debug = true
                class Movie
                    #if debug
                        name as string
                    #else
                        sub test()
                        end sub
                    #end if
                end class
            `);
        });
    });

    describe('interfaces', () => {
        it('preserves interfaces', () => {
            testRoundTrip(`
                interface IMovie
                end interface
                interface IVideo extends IMovie
                    title as string
                    optional duration as integer
                    function getDuration() as integer
                    optional sub play(speed as float, reverse = false as boolean)
                    function noReturnType()
                end interface
            `);
        });
    });

    describe('enums', () => {
        it('preserves enums', () => {
            testRoundTrip(`
                enum Direction
                    up
                    down = "down"
                    left="left"
                end enum
                enum Numbers
                    one = 1
                    two = -2
                end enum
            `);
        });
    });

    describe('namespaces', () => {
        it('preserves namespaces', () => {
            testRoundTrip(`
                namespace alpha
                end namespace
                namespace alpha.beta.charlie
                    sub test()
                        alpha.beta.charlie.test()
                    end sub
                    class Movie
                    end class
                end namespace
            `);
        });
    });

    describe('annotations', () => {
        it('preserves annotations', () => {
            testRoundTrip(`
                @annotation
                @annotationWithArgs(1, "two", { three: 3 })
                sub test()
                end sub
                @classAnnotation()
                class Movie
                    @fieldAnnotation
                    name as string
                    @methodAnnotation(true)
                    public sub test()
                    end sub
                end class
                namespace alpha
                    @inNamespace
                    function test()
                    end function
                end namespace
            `);
        });
    });

    describe('brightscript mode', () => {
        it('preserves a typical brightscript file', () => {
            testRoundTrip(`
                Library "v30/bslDefender.brs"

                Function Main() as Void
                    screen = CreateObject("roSGScreen")
                    port = CreateObject("roMessagePort")
                    screen.setMessagePort(port)
                    scene = screen.CreateScene("MainScene")
                    screen.show()
                    while(true)
                        msg = wait(0, port)
                        msgType = type(msg)
                        if msgType = "roSGScreenEvent"
                            if msg.isScreenClosed() then return
                        end if
                    end while
                End Function
            `, ParseMode.BrightScript);
        });
    });

    describe('syntax errors', () => {
        it('keeps tokens that were skipped by the parser', () => {
            testRoundTrip(`
                sub test()
                    thing = alpha.Direction.
                    print name.
                    t =
                    foo(
                        1,
                        2
                end sub
                function DoSomething
                end function
                class
            `, ParseMode.BrighterScript, true);
        });

        it('keeps tokens for unterminated blocks', () => {
            testRoundTrip(`
                sub test()
                    m.data = {hello:
                end sub
            `, ParseMode.BrighterScript, true);
            testRoundTrip(`sub test()\n    if true\n`, ParseMode.BrighterScript, true);
            testRoundTrip(`class Animal\n    public name as string\n`, ParseMode.BrighterScript, true);
        });
    });

    describe('modified ASTs', () => {
        it('reflects changes to tokens', () => {
            const parser = Parser.parse(`
                sub main()
                    name = "bob"
                end sub
            `);
            const assignment = parser.ast.findChild<AssignmentStatement>(isAssignmentStatement);
            (assignment.tokens.name as any).text = 'firstName';
            (assignment.value as LiteralExpression).tokens.value.text = '"alice"';
            expect(parser.ast.toString()).to.eql(`
                sub main()
                    firstName = "alice"
                end sub
            `);
        });

        it('adds default spacing for statements and expressions added by plugins', () => {
            const parser = Parser.parse(`
                sub main()
                    name = "bob"
                end sub
            `);
            const func = parser.ast.findChild<FunctionStatement>(isFunctionStatement);
            const assignment = func.func.body.statements[0] as AssignmentStatement;
            (assignment as any).value = createStringLiteral('alice');
            func.func.body.statements.push(
                new PrintStatement({
                    print: createToken(TokenKind.Print),
                    expressions: [createStringLiteral('added')]
                })
            );
            expect(parser.ast.toString()).to.eql(`
                sub main()
                    name = "alice"
print "added"
                end sub
            `);
        });

        it('can stringify individual nodes', () => {
            const parser = Parser.parse(`
                sub main()
                    'comment
                    name = "bob"
                end sub
            `);
            const assignment = parser.ast.findChild<AssignmentStatement>(isAssignmentStatement);
            expect(assignment.toString()).to.eql(`\n                    'comment\n                    name = "bob"`);
            expect(assignment.value.toString()).to.eql(` "bob"`);
            expect(parser.ast.findChild(isLiteralExpression).toString()).to.eql(` "bob"`);
        });

        it('includes the eof trivia only for the root body', () => {
            const parser = Parser.parse(`sub main()\nend sub\n'eof comment`);
            expect((parser.ast as Body).tokens.eof).to.exist;
            expect(parser.ast.toString()).to.eql(`sub main()\nend sub\n'eof comment`);
            expect(parser.ast.statements[0].toString()).to.eql(`sub main()\nend sub`);
        });
    });

    describe('parser support', () => {
        it('stores commas on the nodes that use them', () => {
            const parser = Parser.parse(`
                function test(a, b)
                    doSomething(1, 2)
                    x = [1, 2
                        3]
                    y = z[1, 2]
                    z[1, 2] = 3
                    dim w[1, 2]
                    m.node@.callfunc(1, 2)
                end function
            `, { mode: ParseMode.BrighterScript });
            expect(parser.diagnostics).to.be.empty;
            const func = parser.ast.findChild<FunctionStatement>(isFunctionStatement);
            expect(func.func.tokens.commas.map(x => x.text)).to.eql([',']);
            expect(parser.ast.findChild<CallExpression>(isCallExpression).tokens.commas.map(x => x.text)).to.eql([',']);
            expect(parser.ast.findChild<ArrayLiteralExpression>(isArrayLiteralExpression).tokens.commas.map(x => x?.text)).to.eql([',']);
            expect(parser.ast.findChild<IndexedGetExpression>(isIndexedGetExpression).tokens.commas.map(x => x.text)).to.eql([',']);
            expect(parser.ast.findChild<IndexedSetStatement>(isIndexedSetStatement).tokens.commas.map(x => x.text)).to.eql([',']);
            expect(parser.ast.findChild<DimStatement>(isDimStatement).tokens.commas.map(x => x.text)).to.eql([',']);
            expect(parser.ast.findChild<CallfuncExpression>(isCallfuncExpression).tokens.commas.map(x => x.text)).to.eql([',']);
        });

        it('stores the template string expression begin and end tokens', () => {
            const parser = Parser.parse('x = `a${b}c${d}`', { mode: ParseMode.BrighterScript });
            const template = parser.ast.findChild<TemplateStringExpression>(isTemplateStringExpression);
            expect(template.tokens.expressionBegins.map(x => x.text)).to.eql(['${', '${']);
            expect(template.tokens.expressionEnds.map(x => x.text)).to.eql(['}', '}']);
        });

        it('does not include colons in the leading trivia of the next token when the colon is part of the AST', () => {
            const parser = Parser.parse(`x = { a : 1 }
y = true ? 1 : 2`, { mode: ParseMode.BrighterScript });
            const member = parser.ast.findChild<AAMemberExpression>(isAAMemberExpression);
            expect(member.tokens.colon.leadingTrivia.map(x => x.text)).to.eql([' ']);
            expect(member.value.leadingTrivia.map(x => x.text)).to.eql([' ']);
            const ternary = parser.ast.findChild<TernaryExpression>(isTernaryExpression);
            expect(ternary.tokens.colon.leadingTrivia.map(x => x.text)).to.eql([' ']);
            expect(ternary.alternate.leadingTrivia.map(x => x.text)).to.eql([' ']);
        });

        it('keeps the leading trivia of `exitwhile`', () => {
            const parser = Parser.parse(`while true
    exitwhile
end while`);
            const exit = parser.ast.findChild<ExitStatement>(isExitStatement);
            expect(exit.tokens.exit.leadingTrivia.map(x => x.text)).to.eql(['\n', '    ']);
            expect(parser.ast.toString()).to.eql(`while true\n    exitwhile\nend while`);
        });

        it('keeps the location of the `#error` message', () => {
            const parser = Parser.parse(`#error some message`);
            const statement = parser.ast.statements[0] as ConditionalCompileErrorStatement;
            expect(statement.tokens.message.text).to.eql('some message');
            expect(statement.tokens.message.location?.range).to.eql(util.createRange(0, 7, 0, 19));
        });

        it('moves skipped tokens into the leading trivia of the next token in the AST', () => {
            const parser = Parser.parse(`sub main()
    print a.
end sub`);
            expect(parser.diagnostics).not.to.be.empty;
            const func = parser.ast.findChild<FunctionStatement>(isFunctionStatement);
            expect(func.func.tokens.endFunctionType.leadingTrivia.map(x => x.text)).to.eql(['.', '\n']);
        });

        it('does not include unexpected characters in the next token', () => {
            const tokens = Lexer.scan(`x = 1 |\ny = 2`).tokens;
            expect(tokens.find(x => x.kind === TokenKind.Newline).text).to.eql('\n');
        });
    });

    describe('TranspileState', () => {
        const state = new TranspileState('', {});

        it('writes the leading trivia of tokens', () => {
            const token = createToken(TokenKind.Identifier, 'name');
            token.leadingTrivia = [createToken(TokenKind.Newline, '\n'), createToken(TokenKind.Comment, `'comment`), createToken(TokenKind.Whitespace, '  ')];
            expect(state.tokenToSourceNodeWithTrivia(token).toString()).to.eql(`\n'comment  name`);
        });

        it('only writes default trivia for tokens with no location and no leading trivia', () => {
            expect(state.tokenToSourceNodeWithTrivia(createToken(TokenKind.Equal), ' ').toString()).to.eql(' =');
            expect(state.tokenToSourceNodeWithTrivia(createToken(TokenKind.Equal, '=', util.createLocation(0, 0, 0, 1)), ' ').toString()).to.eql('=');
            expect(state.tokenToSourceNodeWithTrivia(createToken(TokenKind.Equal, ''), ' ').toString()).to.eql('');
            expect(state.tokenToSourceNodeWithTrivia(undefined, ' ')).to.be.undefined;
        });

        it('handles tokens that are missing properties', () => {
            expect(state.tokenToSourceNodeWithTrivia({ text: 'name' }).toString()).to.eql('name');
            expect(state.tokenToSourceNodeWithTrivia({ text: 'name', leadingTrivia: null }, ' ').toString()).to.eql(' name');
            expect(state.tokenToSourceNodeWithTrivia({ text: undefined }).toString()).to.eql('');
        });

        it('writes default separators only between nodes added by plugins', () => {
            const parsed = Parser.parse('doSomething(1,2)').ast.findChild<CallExpression>(isCallExpression);
            expect(state.nodesToSourceNode(parsed.args, parsed.tokens.commas, ', ').toString()).to.eql('1,2');
            expect(state.nodesToSourceNode([createIntegerLiteral('1'), createIntegerLiteral('2')], [], ', ').toString()).to.eql('1, 2');
            expect(state.nodesToSourceNode([createIntegerLiteral('1'), createIntegerLiteral('2')]).toString()).to.eql('12');
        });

        it('includes annotations when writing nodes', () => {
            const func = Parser.parse('@one\n@two()\nsub main()\nend sub', { mode: ParseMode.BrighterScript }).ast.statements[0];
            expect(func.annotations).to.be.lengthOf(2);
            expect(state.nodeToSourceNode(func).toString()).to.eql('@one\n@two()\nsub main()\nend sub');
            expect(func.toString()).to.eql('@one\n@two()\nsub main()\nend sub');
        });
    });
});
