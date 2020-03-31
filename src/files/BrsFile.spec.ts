import { assert, expect } from 'chai';
import * as sinonImport from 'sinon';
import { CompletionItemKind, Position, Range } from 'vscode-languageserver';

import { Callable, CallableArg, CommentFlag, Diagnostic, VariableDeclaration } from '../interfaces';
import { Program } from '../Program';
import { BooleanType } from '../types/BooleanType';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { IntegerType } from '../types/IntegerType';
import { StringType } from '../types/StringType';
import { BrsFile } from './BrsFile';

let sinon = sinonImport.createSandbox();

describe('BrsFile', () => {
    let rootDir = process.cwd();
    let program: Program;
    let file: BrsFile;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        file = new BrsFile('abs', 'rel', program);
    });
    afterEach(() => {
        sinon.restore();
    });

    it('sets needsTranspiled to true for .bs files', () => {
        //BrightScript
        expect(new BrsFile(`${rootDir}/source/main.brs`, 'source/main.brs', program).needsTranspiled).to.be.false;
        //BrighterScript
        expect(new BrsFile(`${rootDir}/source/main.bs`, 'source/main.bs', program).needsTranspiled).to.be.true;
    });

    describe('getCompletions', () => {
        it('waits for the file to be processed before collecting completions', async () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    print "hello"
                    Say
                end sub

                sub SayHello()
                end sub
            `);

            let result = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));
            let names = result.map(x => x.label);
            expect(names).to.contain('Main');
            expect(names).to.contain('SayHello');
        });

        it('does not provide duplicate entries for variables', async () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    name = "bob"
                    age = 12
                    name = "john"
                end sub
            `);

            let result = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));

            let count = result.reduce((total, x) => {
                return x.label === 'name' ? total + 1 : total;
            }, 0);
            expect(count).to.equal(1);
        });

        it('does not include `as` and `string` text options when used in function params', async () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)

                end sub
            `);

            let result = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('as');
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('string');
        });

        it('does not provide intellisense results when inside a comment', async () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                    'this is a comment
                end sub
            `);

            let results = await program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 30));
            expect(results).to.be.empty;
        });

    });

    describe('comment flags', () => {
        describe('bs:disable-next-line', () => {
            it('works for all', async () => {
                let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        'bs:disable-next-line
                        name = "bob
                    end sub
                `) as BrsFile;
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: null,
                    range: Range.create(2, 24, 2, 45),
                    affectedRange: Range.create(3, 0, 3, 35)
                } as CommentFlag);
                await program.validate();
                //the "unterminated string" error should be filtered out
                expect(program.getDiagnostics()).to.be.lengthOf(0);
            });

            it('works for specific codes', async () => {
                let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        'bs:disable-next-line: 1000, 1001
                        name = "bob
                    end sub
                `) as BrsFile;
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: [1000, 1001],
                    range: Range.create(2, 24, 2, 57),
                    affectedRange: Range.create(3, 0, 3, 35)
                } as CommentFlag);
                //the "unterminated string" error should be filtered out
                expect(program.getDiagnostics()).to.be.lengthOf(0);
            });

            it('adds diagnostics for unknown diagnostic codes', async () => {
                await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        print "hi" 'bs:disable-line: 123456 999999   aaaab
                    end sub
                `);

                await program.validate();

                expect(program.getDiagnostics()).to.be.lengthOf(3);
                expect(program.getDiagnostics()[0]).to.deep.include({
                    location: Range.create(2, 53, 2, 59)
                } as Diagnostic);
                expect(program.getDiagnostics()[1]).to.deep.include({
                    location: Range.create(2, 60, 2, 66)
                } as Diagnostic);
                expect(program.getDiagnostics()[2]).to.deep.include({
                    location: Range.create(2, 69, 2, 74)
                } as Diagnostic);
            });

        });

        describe('bs:disable-line', () => {
            it('works for all', async () => {
                let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        name = "bob 'bs:disable-line
                    end sub
                `) as BrsFile;
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: null,
                    range: Range.create(2, 36, 2, 52),
                    affectedRange: Range.create(2, 0, 2, 36)
                } as CommentFlag);
                await program.validate();
                //the "unterminated string" error should be filtered out
                expect(program.getDiagnostics()).to.be.lengthOf(0);
            });

            it('works for specific codes', async () => {
                await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        'should not have any errors
                        DoSomething(1) 'bs:disable-line:1002
                        'should have an error because the param-count error is not being suppressed
                        DoSomething(1) 'bs:disable-line:1000
                    end sub
                    sub DoSomething()
                    end sub
                `);

                await program.validate();

                expect(program.getDiagnostics()).to.be.lengthOf(1);
                expect(program.getDiagnostics()[0]).to.deep.include({
                    location: Range.create(5, 24, 5, 35)
                } as Diagnostic);
            });

            it('handles the erraneous `stop` keyword', async () => {
                //the current version of BRS causes parse errors after the `parse` keyword, showing error in comments
                //the program should ignore all diagnostics found in brs:* comment lines EXCEPT
                //for the diagnostics about using unknown error codes
                await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        stop 'bs:disable-line
                        print "need a valid line to fix stop error"
                    end sub
                `);
                await program.validate();
                expect(program.getDiagnostics()).to.be.lengthOf(0);
            });
        });
    });

    describe('parse', () => {
        it('supports labels and goto statements', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    'multiple goto statements on one line
                    goto myLabel : goto myLabel
                    myLabel:
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports empty print statements', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                   print
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports single-word #elseif and #endif', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    #const someFlag = true
                    #if someFlag
                        'code to execute when someFlag is true
                    #elseif someFlag
                        'code to execute when anotherFlag is true
                    #endif
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports multi-word #else if and #end if', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    #const someFlag = true
                    #if someFlag
                        'code to execute when someFlag is true
                    #else if someFlag
                        'code to execute when anotherFlag is true
                    #end if
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not choke on invalid code inside a false conditional compile', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    #if false
                        non-commented code here should not cause parse errors
                    #end if
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports stop statement', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                   stop
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports single-line if statements', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    if 1 < 2: return true: end if
                    if 1 < 2: return true
                    end if
                    if false : print "true" : end if
                    if true: print "8 worked": else if true: print "not run": else: print "not run": end if
                    if true then : test = sub() : print "yes" : end sub : end if
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports line_num as global variable', async () => {
            await file.parse(`
                sub Main()
                    print LINE_NUM
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports many keywords as object property names', async () => {
            await file.parse(`
                sub Main()
                    person = {}
                    person.and = true
                    person.box = true
                    person.createobject = true
                    person.dim = true
                    person.double = true
                    person.each = true
                    person.else = true
                    person.elseif = true
                    person.end = true
                    person.endfor = true
                    person.endfunction = true
                    person.endif = true
                    person.endsub = true
                    person.endwhile = true
                    person.eval = true
                    person.exit = true
                    person.exitfor = true
                    person.exitwhile = true
                    person.false = true
                    person.float = true
                    person.for = true
                    person.foreach = true
                    person.function = true
                    person.getglobalaa = true
                    person.getlastruncompileerror = true
                    person.getlastrunruntimeerror = true
                    person.goto = true
                    person.if = true
                    person.integer = true
                    person.invalid = true
                    person.let = true
                    person.line_num = true
                    person.longinteger = true
                    person.next = true
                    person.not = true
                    person.objfun = true
                    person.or = true
                    person.pos = true
                    person.print = true
                    person.rem = true
                    person.return = true
                    person.run = true
                    person.step = true
                    person.stop = true
                    person.string = true
                    person.sub = true
                    person.tab = true
                    person.then = true
                    person.to = true
                    person.true = true
                    person.type = true
                    person.while = true
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });
        it('does not error on numeric literal type designators', async () => {
            await file.parse(`
                sub main()
                    print &he2
                    print 1.2E+2
                    print 2!
                    print 12D-12
                    print 2.3#
                    print &hFEDCBA9876543210&
                    print 9876543210&
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not error when encountering sub with return type', async () => {
            await file.parse(`
                sub main() as integer
                    return
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not lose function scopes when mismatched end sub', async () => {
            await file.parse(`
                sub main()
                    sayHi()
                end function

                sub sayHi()
                    print "hello world"
                end sub
            `);
            expect(file.functionScopes).to.be.lengthOf(2);
        });

        it('does not lose sub scope when mismatched end function', async () => {
            await file.parse(`
                function main()
                    sayHi()
                end sub

                sub sayHi()
                    print "hello world"
                end sub
            `);
            expect(file.functionScopes).to.be.lengthOf(2);
        });

        it('does not error with boolean in RHS of set statement', async () => {
            await file.parse(`
                sub main()
                    foo = {
                        bar: false
                    }
                    foo.bar = true and false or 3 > 4
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not error with boolean in RHS of set statement', async () => {
            await file.parse(`
                sub main()
                    m = {
                        isTrue: false
                    }
                    m.isTrue = true = true
                    m.isTrue = m.isTrue = true
                    m.isTrue = m.isTrue = m.isTrue
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports variable names ending with type designators', async () => {
            await file.parse(`
                sub main()
                  name$ = "bob"
                  age% = 1
                  height! = 5.5
                  salary# = 9.87654321
                  someHex& = 13
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports multiple spaces between two-word keywords', async () => {
            await file.parse(`
                sub main()
                    if true then
                        print "true"
                    else    if true then
                        print "also true"
                    end if
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not error with `stop` as object key', async () => {
            await file.parse(`
                function GetObject()
                    obj = {
                        stop: function() as void

                        end function
                    }
                    return obj
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('does not error with `run` as object key', async () => {
            await file.parse(`
                function GetObject()
                    obj = {
                        run: function() as void

                        end function
                    }
                    return obj
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports assignment operators', async () => {
            await file.parse(`
                function Main()
                    x = 1
                    x += 1
                    x += 2
                    x -= 1
                    x /= 2
                    x = 9
                    x \\= 2
                    x *= 3.0
                    x -= 1
                    print x
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports `then` as object property', async () => {
            await file.parse(`
                function Main()
                    promise = {
                        then: sub()
                        end sub
                    }
                    promise.then()
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports function as parameter type', async () => {
            await file.parse(`
                sub Main()
                    doWork = function(callback as function)
                    end function
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports increment operator', async () => {
            await file.parse(`
                function Main()
                    x = 3
                    x++
                end function
            `);
            file.getDiagnostics();
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports decrement operator', async () => {
            await file.parse(`
                function Main()
                    x = 3
                    x--
                end function
            `);
            file.getDiagnostics();
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports writing numbers with decimal but no trailing digit', async () => {
            await file.parse(`
                function Main()
                    x = 3.
                    print x
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports assignment operators against object properties', async () => {
            await file.parse(`
                function Main()
                    m.age = 1

                    m.age += 1
                    m.age -= 1
                    m.age *= 1
                    m.age /= 1
                    m.age \\= 1

                    m["age"] += 1
                    m["age"] -= 1
                    m["age"] *= 1
                    m["age"] /= 1
                    m["age"] \\= 1

                    print m.age
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        //skipped until `brs` supports this
        it('supports bitshift assignment operators', async () => {
            await file.parse(`
                function Main()
                    x = 1
                    x <<= 8
                    x >>= 4
                    print x
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        //skipped until `brs` supports this
        it('supports bitshift assignment operators on objects', async () => {
            await file.parse(`
                    function Main()
                        m.x = 1
                        m.x <<= 1
                        m.x >>= 1
                        print m.x
                    end function
                `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports leading and trailing periods for numeric literals', async () => {
            await file.parse(`
                function Main()
                    one = 1.
                    print one
                    pointOne = .1
                    print pointOne
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it.skip('supports bitshift assignment operators on object properties accessed by array syntax', async () => {
            await file.parse(`
                    function Main()
                        m.x = 1
                        'm['x'] << 1
                        'm['x'] >> 1
                        print m.x
                    end function
                `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it.skip('supports weird period AA accessor', async () => {
            await file.parse(`
                function Main()
                    m._uuid = "123"
                    print m.["_uuid"]
                end function
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports library imports', async () => {
            await file.parse(`
                Library "v30/bslCore.brs"
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('supports colons as separators in associative array properties', async () => {
            await file.parse(`
                sub Main()
                    obj = {x:0 : y: 1}
                end sub
            `);
            expect(file.getDiagnostics()).to.be.lengthOf(0);
        });

        it('succeeds when finding variables with "sub" in them', async () => {
            await file.parse(`
                function DoSomething()
                    return value.subType()
                end function
            `);
            expect(file.callables[0]).to.deep.include({
                bodyRange: Range.create(2, 0, 3, 16),
                file: file,
                nameRange: Range.create(1, 25, 1, 36)
            });
        });

        it('succeeds when finding variables with the word "function" in them', async () => {
            await file.parse(`
                function Test()
                    typeCheckFunction = RBS_CMN_GetFunction(invalid, methodName)
                end function
            `);
        });

        it('finds line and column numbers for functions', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoB()
                     print "B"
                 end function
            `);
            expect(file.callables[0].name).to.equal('DoA');
            expect(file.callables[0].nameRange).to.eql(Range.create(1, 25, 1, 28));

            expect(file.callables[1].name).to.equal('DoB');
            expect(file.callables[1].nameRange).to.eql(Range.create(5, 26, 5, 29));
        });

        it('throws an error if the file has already been parsed', async () => {
            let file = new BrsFile('abspath', 'relpath', program);
            await file.parse(`'a comment`);
            try {
                await file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('finds and registers duplicate callables', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expect(file.callables.length).to.equal(2);
            expect(file.callables[0].name).to.equal('DoA');
            expect(file.callables[0].nameRange.start.line).to.equal(1);

            expect(file.callables[1].name).to.equal('DoA');
            expect(file.callables[1].nameRange.start.line).to.equal(5);
        });

        it('finds function call line and column numbers', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    DoB("a")
                end function
                function DoB(a as string)
                    DoC()
                end function
            `);
            expect(file.functionCalls.length).to.equal(2);

            expect(file.functionCalls[0].range).to.eql(Range.create(2, 20, 2, 28));
            expect(file.functionCalls[0].nameRange).to.eql(Range.create(2, 20, 2, 23));

            expect(file.functionCalls[1].range).to.eql(Range.create(5, 20, 5, 25));
            expect(file.functionCalls[1].nameRange).to.eql(Range.create(5, 20, 5, 23));
        });

        it('sanitizes brs errors', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoSomething
                end function
            `);
            expect(file.getDiagnostics().length).to.be.greaterThan(0);
            expect(file.getDiagnostics()[0]).to.deep.include({
                file: file
            });
            expect(file.getDiagnostics()[0].location.start.line).to.equal(1);
        });

        it('supports using the `next` keyword in a for loop', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub countit()
                    for each num in [1,2,3]
                        print num
                    next
                end sub
            `);
            expect(file.getDiagnostics()).to.be.empty;
        });

        //test is not working yet, but will be enabled when brs supports this syntax
        it('supports assigning functions to objects', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function main()
                    o = CreateObject("roAssociativeArray")
                    o.sayHello = sub()
                        print "hello"
                    end sub
                end function
            `);
            expect(file.getDiagnostics().length).to.equal(0);
        });
    });

    describe('findCallables', () => {
        it('finds body range', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub Sum()
                    print "hello world"
                end sub
            `);
            let callable = file.callables[0];
            expect(callable.bodyRange).to.eql(Range.create(2, 0, 3, 16));
        });

        it('finds correct body range even with inner function', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub Sum()
                    sayHi = sub()
                        print "Hi"
                    end sub
                    sayHi()
                end sub
            `);
            let callable = file.callables[0];
            expect(callable.bodyRange).to.eql(Range.create(2, 0, 6, 16));
        });

        it('finds callable parameters', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function Sum(a, b, c)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(DynamicType);

            expect(callable.params[1]).to.deep.include({
                name: 'b',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[1].type).instanceof(DynamicType);

            expect(callable.params[2]).to.deep.include({
                name: 'c',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[2].type).instanceof(DynamicType);
        });

        it('finds optional parameters', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function Sum(a=2)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: true,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(DynamicType);
        });

        it('finds parameter types', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function Sum(a, b as integer, c as string)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(DynamicType);

            expect(callable.params[1]).to.deep.include({
                name: 'b',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[1].type).instanceof(IntegerType);

            expect(callable.params[2]).to.deep.include({
                name: 'c',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[2].type).instanceof(StringType);
        });
    });

    describe('findCallableInvocations', () => {
        it('finds arguments with literal values', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function Sum()
                    DoSomething("name", 12, true)
                end function
            `);
            expect(file.functionCalls.length).to.equal(1);
            let args = file.functionCalls[0].args;
            expect(args.length).to.equal(3);
            expect(args[0]).deep.include(<CallableArg>{
                type: new StringType(),
                text: '"name"'
            });
            expect(args[1]).deep.include(<CallableArg>{
                type: new IntegerType(),
                text: '12'
            });
            expect(args[2]).deep.include(<CallableArg>{
                type: new BooleanType(),
                text: 'true'
            });
        });

        it('finds arguments with variable values', async () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function Sum()
                    count = 1
                    name = "John"
                    isAlive = true
                    DoSomething(count, name, isAlive)
                end function
            `);
            expect(file.functionCalls.length).to.equal(1);
            expect(file.functionCalls[0].args[0]).deep.include({
                type: new DynamicType(),
                text: 'count'
            });
            expect(file.functionCalls[0].args[1]).deep.include({
                type: new DynamicType(),
                text: 'name'
            });
            expect(file.functionCalls[0].args[2]).deep.include({
                type: new DynamicType(),
                text: 'isAlive'
            });
        });
    });

    describe('standardizeLexParserErrors', () => {
        it('properly maps the location to a Range', () => {
            let file = new BrsFile('', '', program);
            expect(file.standardizeLexParseErrors([<any>{
                location: {
                    start: {
                        column: 0,
                        line: 1
                    }, end: {
                        column: 4,
                        line: 2
                    },
                    file: ''
                },
                message: 'some lex error',
                stack: ''
            }])).to.eql([<Diagnostic>{
                code: 1000,
                message: 'some lex error',
                location: Range.create(0, 0, 1, 4),
                file: file,
                severity: 'error'
            }]);
        });
    });

    describe('findCallables', () => {
        //this test is to help with code coverage
        it('skips top-level statements', async () => {
            let file = new BrsFile('absolute', 'relative', program);
            await file.parse('name = "Bob"');
            expect(file.callables.length).to.equal(0);
        });

        it('finds return type', async () => {
            let file = new BrsFile('absolute', 'relative', program);
            await file.parse(`
                function DoSomething() as string
                end function
            `);
            expect(file.callables[0]).to.deep.include(<Partial<Callable>>{
                file: file,
                nameRange: Range.create(1, 25, 1, 36),
                name: 'DoSomething',
                params: []
            });
            expect(file.callables[0].type.returnType).instanceof(StringType);
        });
    });

    describe('createFunctionScopes', () => {
        it('creates range properly', async () => {
            await file.parse(`
                sub Main()
                    name = 'bob"
                end sub
            `);
            expect(file.functionScopes[0].range).to.eql(Range.create(1, 16, 3, 23));
        });

        it('creates scopes for parent and child functions', async () => {
            await file.parse(`
                sub Main()
                    sayHi = sub()
                        print "hi"
                    end sub

                    scheduleJob(sub()
                        print "job completed"
                    end sub)
                end sub
            `);
            expect(file.functionScopes).to.length(3);
        });

        it('outer function does not capture inner statements', async () => {
            await file.parse(`
                sub Main()
                    name = "john"
                    sayHi = sub()
                        age = 12
                    end sub
                end sub
            `);
            let outerScope = file.getFunctionScopeAtPosition(Position.create(2, 25));
            expect(outerScope.variableDeclarations).to.be.lengthOf(2);

            let innerScope = file.getFunctionScopeAtPosition(Position.create(4, 10));
            expect(innerScope.variableDeclarations).to.be.lengthOf(1);
        });

        it('finds variables declared in function scopes', async () => {
            await file.parse(`
                sub Main()
                    sayHi = sub()
                        age = 12
                    end sub

                    scheduleJob(sub()
                        name = "bob"
                    end sub)
                end sub
            `);
            expect(file.functionScopes[0].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[0].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 2,
                name: 'sayHi'
            });
            expect(file.functionScopes[0].variableDeclarations[0].type).instanceof(FunctionType);

            expect(file.functionScopes[1].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[1].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 3,
                name: 'age'
            });
            expect(file.functionScopes[1].variableDeclarations[0].type).instanceof(IntegerType);

            expect(file.functionScopes[2].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[2].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 7,
                name: 'name'
            });
            expect(file.functionScopes[2].variableDeclarations[0].type).instanceof(StringType);
        });

        it('finds variable declarations inside of if statements', async () => {
            await file.parse(`
                sub Main()
                    if true then
                        theLength = 1
                    end if
                end sub
            `);
            let scope = file.getFunctionScopeAtPosition(Position.create(3, 0));
            expect(scope.variableDeclarations[0]).to.exist;
            expect(scope.variableDeclarations[0].name).to.equal('theLength');
        });

        it('finds value from global return', async () => {
            await file.parse(`
                sub Main()
                   myName = GetName()
                end sub

                function GetName() as string
                    return "bob"
                end function
            `);

            expect(file.functionScopes[0].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[0].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 2,
                name: 'myName'
            });
            expect(file.functionScopes[0].variableDeclarations[0].type).instanceof(StringType);
        });

        it('finds variable type from other variable', async () => {
            await file.parse(`
                sub Main()
                   name = "bob"
                   nameCopy = name
                end sub
            `);

            expect(file.functionScopes[0].variableDeclarations).to.be.length(2);
            expect(file.functionScopes[0].variableDeclarations[1]).to.deep.include(<VariableDeclaration>{
                lineIndex: 3,
                name: 'nameCopy'
            });
            expect(file.functionScopes[0].variableDeclarations[1].type).instanceof(StringType);
        });

        it('sets proper range for functions', async () => {
            await file.parse(`
                sub Main()
                    getName = function()
                        return "bob"
                    end function
                end sub
            `);

            expect(file.functionScopes).to.be.length(2);
            expect(file.functionScopes[0].bodyRange).to.eql(Range.create(2, 0, 5, 16));
            expect(file.functionScopes[1].bodyRange).to.eql(Range.create(3, 0, 4, 20));
        });
    });

    describe('getHover', () => {
        it('works for param types', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething(name as string)
                    name = 1
                    sayMyName = function(name as string)
                    end function
                end sub
            `);

            //hover over the `name = 1` line
            let hover = await file.getHover(Position.create(2, 24));
            expect(hover).to.exist;
            expect(hover.range).to.eql(Range.create(2, 20, 2, 24));

            //hover over the `name` parameter declaration
            hover = await file.getHover(Position.create(1, 34));
            expect(hover).to.exist;
            expect(hover.range).to.eql(Range.create(1, 32, 1, 36));
        });

        //ignore this for now...it's not a huge deal
        it.skip('does not match on keywords or data types', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                end sub
                sub as()
                end sub
            `);
            //hover over the `as`
            expect(file.getHover(Position.create(1, 31))).not.to.exist;
            //hover over the `string`
            expect(file.getHover(Position.create(1, 36))).not.to.exist;
        });

        it('finds declared function', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            `);

            let hover = await file.getHover(Position.create(1, 28));
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(1, 25, 1, 29));
            expect(hover.contents).to.equal('function Main(count? as dynamic) as dynamic');
        });

        it('finds variable function hover in same scope', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);

            let hover = await file.getHover(Position.create(5, 24));

            expect(hover.range).to.eql(Range.create(5, 20, 5, 29));
            expect(hover.contents).to.equal('sub sayMyName(name as string) as void');
        });

        it('finds function hover in file scope', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);

            let hover = await file.getHover(Position.create(2, 25));

            expect(hover.range).to.eql(Range.create(2, 20, 2, 29));
            expect(hover.contents).to.equal('sub sayMyName() as void');
        });

        it('finds function hover in context scope', async () => {
            let rootDir = process.cwd();
            let program = new Program({
                rootDir: rootDir
            });

            let mainFile = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub sayMyName(name as string)

                end sub
            `);

            let hover = await mainFile.getHover(Position.create(2, 25));
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(2, 20, 2, 29));
            expect(hover.contents).to.equal('sub sayMyName(name as string) as void');
        });

        it('handles mixed case `then` partions of conditionals', async () => {
            let mainFile = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true then
                        print "works"
                    end if
                end sub
            `);

            expect(mainFile.getDiagnostics()).to.be.lengthOf(0);
            mainFile = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true Then
                        print "works"
                    end if
                end sub
            `);
            expect(mainFile.getDiagnostics()).to.be.lengthOf(0);

            mainFile = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true THEN
                        print "works"
                    end if
                end sub
            `);
            expect(mainFile.getDiagnostics()).to.be.lengthOf(0);
        });
    });

    describe('transpile', () => {
        it('keeps end-of-line comments with their line', async () => {
            await testTranspile(`
                function DoSomething() 'comment 1
                    name = "bob" 'comment 2
                end function 'comment 3
            `);
        });

        it('works for functions', async () => {
            await testTranspile(`
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile



                end function
            `, `
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile
                end function
            `);
        });

        it('keeps empty AAs and arrays on same line', async () => {
            await testTranspile(`
                sub a()
                    person = {}
                    stuff = []
                end sub
        `, null, 'trim');
        });

        it('adds `then` when missing', async () => {
            await testTranspile(`
                sub a()
                    if true
                        print "true"
                    else if true
                        print "true"
                    else
                        print "true"
                    end if
                end sub
            `, `
                sub a()
                    if true then
                        print "true"
                    else if true then
                        print "true"
                    else
                        print "true"
                    end if
                end sub
            `, 'trim');
        });

        it('works for function parameters', async () => {
            await testTranspile(`
                function DoSomething(name, age as integer, text as string)
                end function
            `, `
                function DoSomething(name, age as integer, text as string)
                end function
            `);
        });

        it('adds newlines between top-level statements', async () => {
            await testTranspile(`
                function a()
                end function

                function b()
                end function
            `);
        });

        it('properly indents nested AA literals', async () => {
            await testTranspile(`
                sub doSomething()
                    grandparent = {
                        parent: {
                            child: {
                                grandchild: {
                                    name: "baby"
                                }
                            }
                        }
                    }
                end sub
            `);
        });

        it('does not add comma after final object property even when comments are present', async () => {
            await testTranspile(`
                sub doSomething()
                    person = {
                        age: 12, 'comment
                        name: "child"
                    }
                    person = {
                        age: 12, 'comment
                        name: "child" 'comment
                    }
                    person = {
                        age: 12, 'comment
                        name: "child"
                        'comment
                    }
                    person = {
                        age: 12, 'comment
                        name: "child" 'comment
                        'comment
                    }
                end sub
            `);
        });

        it('works for a complex function with comments all over the place', async () => {
            await testTranspile(`
                'import some library
                library "v30/bslCore.brs" 'comment

                'a function that does something
                function doSomething(age as integer, name = "bob") 'comment
                    person = { 'comment
                        name: "parent", 'comment
                        "age": 12,
                        'comment as whole line
                        child: { 'comment
                            name: "child" 'comment
                        }
                    }
                    person.name = "john" 'comment
                    person.child.name = "baby" 'comment
                    person["name"] = person.child["name"] 'comment
                    age = 12 + 2 'comment
                    name = "tim" 'comment
                    age = 12 'comment
                    while true 'comment
                        age = age + 1 'comment
                        exit while 'comment
                    end while 'comment
                    while age < 12 or age < 15 'comment
                        age++ 'comment
                        exit while 'comment
                    end while 'comment
                    if true or 1 = 1 or name = "tim" then 'comment
                        print false 'comment
                    else if false or "cat" = "dog" or true then 'comment
                        print "true" 'comment
                    else 'comment
                        print "else" 'comment
                    end if 'comment
                    someBool = (true or false) or ((true) or (false)) 'comment
                    mylabel: 'comment
                    goto mylabel 'comment
                    age++ 'comment
                    age-- 'comment
                    end 'comment
                    stop 'comment
                    indexes = [ 'comment
                        'comment on its own line
                        1, 'comment
                        2, 'comment
                        3 'comment
                    ] 'comment
                    firstIndex = indexes[0] 'comment
                    for each idx in indxes 'comment
                        indexes[idx] = idx + 1 'comment
                    end for 'comment
                    if not true then 'comment
                        print "false" 'comment
                    end if 'comment 'comment
                    for i = 0 to 10 step 1 'comment
                        name = "bob" 'comment
                        age = 12 'comment
                        exit for 'comment
                    end for 'comment
                    callback = function(name, age as integer, cb as Function) as integer 'comment
                        returnValue = 12 'comment
                        return returnValue 'comment
                    end function 'comment
                    print "a" ; "b" ; 3 'comment
                    a(1, 2, 3) 'comment
                    person.functionCall(1, 2, 3) 'comment
                    if true then 'comment
                        level = 1 'comment
                        if false then 'comment
                            level = 2 'comment
                            if true or false then 'comment
                                level = 3 'comment
                                if false and true then 'comment
                                    level = 4 'comment
                                end if 'comment
                            end if 'comment
                        end if 'comment
                    end if 'comment
                end function

                function a(p1, p2, p3) 'comment
                end function 'comment
            `);
        });

        async function testTranspile(source: string, expected?: string, formatType: 'trim' | 'format' | 'none' = 'trim') {
            let formatter = null; //new BrightScriptFormatter();
            expected = expected ? expected : source;
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, source) as BrsFile;
            let firstDiagnosticMessage = file.getDiagnostics().length > 0 ? file.getDiagnostics()[0].message : '';
            expect(file.getDiagnostics()).to.be.lengthOf(0, `Found parse errors: '${firstDiagnosticMessage}'`);
            let transpiled = file.transpile();

            let sources = [transpiled.code, expected];
            for (let i = 0; i < sources.length; i++) {
                if (formatType === 'trim') {
                    let lines = sources[i].split('\n');
                    //throw out leading newlines
                    while (lines[0].length === 0) {
                        lines.splice(0, 1);
                    }
                    let trimStartIndex = null;
                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                        //if we don't have a starting trim count, compute it
                        if (!trimStartIndex) {
                            trimStartIndex = lines[lineIndex].length - lines[lineIndex].trim().length;
                        }
                        //only trim the expected file (since that's what we passed in from the test)
                        if (lines[lineIndex].length > 0 && i === 1) {
                            lines[lineIndex] = lines[lineIndex].substring(trimStartIndex);
                        }
                    }
                    //trim trailing newlines
                    while (lines[lines.length - 1].length === 0) {
                        lines.splice(lines.length - 1);
                    }
                    sources[i] = lines.join('\n');

                } else if (formatType === 'format') {
                    sources[i] = formatter.format(sources[i].trim());
                }
            }
            expect(sources[0]).to.equal(sources[1]);
            return transpiled;
        }
    });
});
