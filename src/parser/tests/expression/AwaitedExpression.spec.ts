import { expect } from '../../../chai-config.spec';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { Parser, ParseMode } from '../../Parser';
import { Program } from '../../../Program';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile } from '../../../testHelpers.spec';
import { isAssignmentStatement, isAwaitedExpression, isCallExpression, isFunctionExpression, isTypedFunctionType, isVariableExpression } from '../../../astUtils/reflection';
import type { AssignmentStatement, FunctionStatement, MethodStatement, ClassStatement } from '../../Statement';
import type { AwaitedExpression, FunctionExpression } from '../../Expression';
import type { BrsFile } from '../../../files/BrsFile';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import { util } from '../../../util';
import { createVisitor, WalkMode } from '../../../astUtils/visitors';
import type { AstNode } from '../../AstNode';

describe('AwaitedExpression', () => {
    function parse(source: string, mode = ParseMode.BrighterScript) {
        return Parser.parse(source, { mode: mode });
    }

    /**
     * Get every node in the AST that matches the matcher, including those inside nested functions
     */
    function findAll<T extends AstNode>(ast: AstNode, matcher: (node: AstNode) => boolean) {
        const result = [] as T[];
        ast.walk((node) => {
            if (matcher(node)) {
                result.push(node as T);
            }
        }, { walkMode: WalkMode.visitAllRecursive });
        return result;
    }

    describe('lexer', () => {
        it('tokenizes async and await as keywords', () => {
            const { tokens } = Lexer.scan('async await');
            expect(tokens.map(x => x.kind)).to.eql([TokenKind.Async, TokenKind.Await, TokenKind.Eof]);
        });

        it('is case insensitive', () => {
            const { tokens } = Lexer.scan('ASYNC Await');
            expect(tokens.map(x => x.kind)).to.eql([TokenKind.Async, TokenKind.Await, TokenKind.Eof]);
        });
    });

    describe('parser - async functions', () => {
        it('parses an async function statement', () => {
            const { ast, diagnostics } = parse(`
                async function getUser()
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            const func = ast.statements[0] as FunctionStatement;
            expect(func.isAsync).to.be.true;
            expect(func.func.isAsync).to.be.true;
            expect(func.func.tokens.async.text).to.equal('async');
            expect(func.tokens.name.text).to.equal('getUser');
        });

        it('parses an async sub statement', () => {
            const { ast, diagnostics } = parse(`
                async sub doWork()
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect((ast.statements[0] as FunctionStatement).isAsync).to.be.true;
        });

        it('includes the async keyword in the function bounds', () => {
            const { ast } = parse(`async function getUser()\nend function`);
            const func = ast.statements[0] as FunctionStatement;
            expect(func.location.range.start).to.eql({ line: 0, character: 0 });
            expect(func.func.location.range.start).to.eql({ line: 0, character: 0 });
        });

        it('marks regular functions as not async', () => {
            const { ast } = parse(`
                function getUser()
                end function
            `);
            const func = ast.statements[0] as FunctionStatement;
            expect(func.isAsync).to.be.false;
            expect(func.func.tokens.async).to.be.undefined;
        });

        it('parses async anonymous functions', () => {
            const { ast, diagnostics } = parse(`
                sub main()
                    a = async function()
                    end function
                    b = async sub()
                    end sub
                    c = function()
                    end function
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            const funcs = findAll<FunctionExpression>(ast, isFunctionExpression);
            expect(funcs.map(x => x.isAsync)).to.eql([false, true, true, false]);
        });

        it('parses an async function passed as an argument', () => {
            const { ast, diagnostics } = parse(`
                sub main()
                    doWork(async function()
                    end function)
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            const funcs = findAll<FunctionExpression>(ast, isFunctionExpression);
            expect(funcs.map(x => x.isAsync)).to.eql([false, true]);
        });

        it('parses async functions in namespaces', () => {
            const { ast, diagnostics } = parse(`
                namespace alpha
                    async function getUser()
                    end function
                end namespace
            `);
            expectZeroDiagnostics(diagnostics);
            const funcs = findAll<FunctionExpression>(ast, isFunctionExpression);
            expect(funcs.map(x => x.isAsync)).to.eql([true]);
        });

        it('parses async class methods', () => {
            const { ast, diagnostics } = parse(`
                class Person
                    async function getName()
                    end function
                    public async sub load()
                    end sub
                    public override async function toString()
                    end function
                    function regular()
                    end function
                end class
            `);
            expectZeroDiagnostics(diagnostics);
            const methods = (ast.statements[0] as ClassStatement).methods;
            expect(methods.map(x => x.tokens.name.text)).to.eql(['getName', 'load', 'toString', 'regular']);
            expect(methods.map(x => x.isAsync)).to.eql([true, true, true, false]);
            expect((methods[2] as MethodStatement).tokens.override?.text).to.equal('override');
        });

        it('allows async as a class field name', () => {
            const { ast, diagnostics } = parse(`
                class Person
                    async as boolean
                    await = 1
                end class
            `);
            expectZeroDiagnostics(diagnostics);
            expect((ast.statements[0] as ClassStatement).fields.map(x => x.tokens.name.text)).to.eql(['async', 'await']);
        });

        it('flags async functions in brs files', () => {
            const { diagnostics } = parse(`
                async function getUser()
                end function
            `, ParseMode.BrightScript);
            expectDiagnostics(diagnostics, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('async functions')
            ]);
        });
    });

    describe('parser - await', () => {
        function getAwaitedExpressions(source: string, mode = ParseMode.BrighterScript) {
            const { ast, diagnostics } = parse(source, mode);
            return { awaits: findAll<AwaitedExpression>(ast, isAwaitedExpression), diagnostics: diagnostics, ast: ast };
        }

        it('parses await as a standalone statement, an assignment value, and a return value', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                async function main()
                    await doWork()
                    user = await getUser()
                    return await getName(user)
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(awaits).to.be.lengthOf(3);
            expect(awaits.map(x => x.parent.kind)).to.eql(['ExpressionStatement', 'AssignmentStatement', 'ReturnStatement']);
            expect(awaits.every(x => isCallExpression(x.expression))).to.be.true;
        });

        it('parses await of a variable and other expressions', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                async function main(promise)
                    a = await promise
                    b = await m.promise
                    c = await 1
                    d = await "text"
                    e = await invalid
                    f = await true
                    g = await { name: "bob" }
                    h = await new Person()
                    i = await createObject("roSGNode", "Node")
                    j = await not promise
                    k = await await promise
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            //`await await promise` produces two awaited expressions
            expect(awaits).to.be.lengthOf(12);
            expect(isVariableExpression(awaits[0].expression)).to.be.true;
        });

        it('binds tighter than binary operators', () => {
            const { ast, diagnostics } = parse(`
                async function main()
                    total = await getCount() + 1
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            const assignment = findAll<AssignmentStatement>(ast, isAssignmentStatement)[0];
            expect(assignment.value.kind).to.equal('BinaryExpression');
            expect(isAwaitedExpression((assignment.value as any).left)).to.be.true;
        });

        it('treats parens, brackets, and signs after await as the awaited value inside an async function', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                async function main()
                    a = await (getUser())
                    b = await [1, 2]
                    c = await -1
                    d = await +1
                    await (doWork())
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(awaits).to.be.lengthOf(5);
        });

        it('treats await as an identifier when used like a variable or function', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                function main()
                    await = 1
                    await += 1
                    await++
                    print await
                    print await; "text"
                    x = await
                    x = await.name
                    x = await["name"]
                    x = await(1)
                    x = await - 1
                    x = await + 1
                    x = await * 2
                    x = [await]
                    x = { await: await }
                    x = await as string
                    for each await in [1, 2]
                    end for
                    for await = 0 to 10
                    end for
                    if await then
                    end if
                    await.name = 1
                    await(1)
                    return await
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(awaits).to.be.lengthOf(0);
        });

        it('treats async as an identifier when not followed by function or sub', () => {
            const { ast, diagnostics } = parse(`
                function main()
                    async = 1
                    print async
                    x = async + 1
                    x = async(1)
                    async(1)
                    return async
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(findAll<FunctionExpression>(ast, isFunctionExpression).map(x => x.isAsync)).to.eql([false]);
        });

        it('allows async and await as function names', () => {
            const { ast, diagnostics } = parse(`
                function async()
                end function
                sub await()
                end sub
            `);
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements.map(x => (x as FunctionStatement).tokens.name.text)).to.eql(['async', 'await']);
        });

        it('allows async and await as parameter names and property names', () => {
            const { diagnostics } = parse(`
                function main(async, await)
                    m.async = async
                    m.await = await
                    x = { async: 1, await: 2 }
                    return x.async + x.await
                end function
            `);
            expectZeroDiagnostics(diagnostics);
        });

        it('treats parens after await as a call outside of an async function, including inside a nested function', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                async function main()
                    callback = function()
                        x = await(1)
                    end function
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(awaits).to.be.lengthOf(0);
        });

        it('parses await with an operand outside of an async function (validation flags it)', () => {
            const { awaits, diagnostics } = getAwaitedExpressions(`
                function main()
                    x = await getUser()
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(awaits).to.be.lengthOf(1);
        });

        it('flags await in brs files', () => {
            const { diagnostics } = parse(`
                function main()
                    x = await getUser()
                end function
            `, ParseMode.BrightScript);
            expectDiagnostics(diagnostics, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('await')
            ]);
        });

        it('clones an awaited expression', () => {
            const { awaits } = getAwaitedExpressions(`
                async function main()
                    x = await getUser()
                end function
            `);
            const clone = awaits[0].clone();
            expect(isAwaitedExpression(clone)).to.be.true;
            expect(clone.tokens.await.text).to.equal('await');
            expect(clone.expression).not.to.equal(awaits[0].expression);
            expect(clone.expression.parent).to.equal(clone);
        });

        it('clones an async function', () => {
            const { ast } = parse(`
                async function main()
                end function
            `);
            const clone = (ast.statements[0] as FunctionStatement).clone();
            expect(clone.isAsync).to.be.true;
        });

        it('visits awaited expressions', () => {
            const { ast } = parse(`
                async function main()
                    x = await getUser()
                end function
            `);
            const visited = [] as AwaitedExpression[];
            ast.walk(createVisitor({
                AwaitedExpression: (expression) => {
                    visited.push(expression);
                }
            }), { walkMode: WalkMode.visitAllRecursive });
            expect(visited).to.be.lengthOf(1);
        });
    });

    describe('validation', () => {
        let rootDir = process.cwd();
        let program: Program;

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        it('allows await in the supported placements', () => {
            program.setFile('source/main.bs', `
                async function main()
                    await doWork()
                    user = await getUser()
                    m.user = await getUser()
                    m.users["bob"] = await getUser()
                    m.users[0] = await getUser()
                    try
                        await doWork()
                        name = await getUser()
                        m.user = await getUser()
                        m.users["bob"] = await getUser()
                        try
                            await doWork()
                        catch e
                        end try
                        return await getUser()
                    catch e
                        print e
                    end try
                    return await getUser()
                end function
                function getUser()
                end function
                sub doWork()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows await in async class methods and async anonymous functions', () => {
            program.setFile('source/main.bs', `
                class Person
                    name as string
                    async function load()
                        m.name = "bob"
                        name = await getName()
                    end function
                end class
                sub main()
                    callback = async function()
                        name = await getName()
                    end function
                end sub
                function getName()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags await outside of an async function', () => {
            program.setFile('source/main.bs', `
                function main()
                    user = await getUser()
                end function
                function getUser()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.awaitOutsideAsyncFunction(),
                location: { range: util.createRange(2, 27, 2, 32) }
            }]);
        });

        it('flags await at the top level of a file', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    x = await getUser()
                end namespace
            `);
            program.validate();
            expectDiagnosticsIncludesCode('await-outside-async-function');
        });

        it('flags await in a non-async function nested inside an async function', () => {
            program.setFile('source/main.bs', `
                async function main()
                    callback = function()
                        user = await getUser()
                    end function
                end function
                function getUser()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.awaitOutsideAsyncFunction()
            ]);
        });

        it('flags await nested in another expression', () => {
            program.setFile('source/main.bs', `
                async function main()
                    total = 0
                    print await getUser()
                    x = 1 + await getUser()
                    x = await getUser() + 1
                    doWork(await getUser())
                    x = [await getUser()]
                    x = { user: await getUser() }
                    m.user += await getUser()
                    m[await getKey()] = 1
                    m[getKey()][await getKey()] = 1
                    total += await getUser()
                    x = (await getUser())
                    return not await getUser()
                end function
                function getUser()
                end function
                function getKey()
                end function
                sub doWork(value)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                ...Array(12).fill(DiagnosticMessages.awaitNotSupportedHere())
            ]);
        });

        it('flags only the inner await of a double await', () => {
            program.setFile('source/main.bs', `
                async function main()
                    x = await await getUser()
                end function
                function getUser()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.awaitNotSupportedHere(),
                location: { range: util.createRange(2, 30, 2, 35) }
            }]);
        });

        it('flags await inside control flow', () => {
            program.setFile('source/main.bs', `
                async function main()
                    if true then
                        await doWork()
                    end if
                    if true then await doWork()
                    for i = 0 to 1
                        await doWork()
                    end for
                    for each item in [1]
                        await doWork()
                    end for
                    while m.isRunning
                        await doWork()
                    end while
                    select case m.value
                        case 1
                            await doWork()
                        case else
                    end select
                    #if DEBUG
                        await doWork()
                    #end if
                end function
                sub doWork()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                ...Array(7).fill(DiagnosticMessages.awaitNotSupportedHere())
            ]);
        });

        it('flags await inside a catch block', () => {
            program.setFile('source/main.bs', `
                async function main()
                    try
                        await doWork()
                    catch e
                        await doWork()
                    end try
                end function
                sub doWork()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.awaitNotSupportedHere(),
                location: { range: util.createRange(5, 24, 5, 29) }
            }]);
        });

        it('flags await in a try block nested in control flow', () => {
            program.setFile('source/main.bs', `
                async function main()
                    if true then
                        try
                            await doWork()
                        catch e
                        end try
                    end if
                end function
                sub doWork()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.awaitNotSupportedHere()
            ]);
        });

        it('flags an async class constructor', () => {
            program.setFile('source/main.bs', `
                class Person
                    async sub new()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.asyncClassConstructor(),
                location: { range: util.createRange(2, 20, 2, 25) }
            }]);
        });

        function expectDiagnosticsIncludesCode(code: string) {
            expect(program.getDiagnostics().map(x => x.code)).to.include(code);
        }
    });

    describe('types', () => {
        let rootDir = process.cwd();
        let program: Program;

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        function getAssignmentType(file: BrsFile, name: string) {
            const assignment = findAll<AssignmentStatement>(file.ast, isAssignmentStatement).find(x => x.tokens.name.text === name);
            return assignment.value.getType({ flags: SymbolTypeFlag.runtime });
        }

        it('types an async function by its awaited return type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                async function getName() as string
                    return "bob"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const funcType = (file.ast.statements[0] as FunctionStatement).func.getType({ flags: SymbolTypeFlag.runtime });
            expect(isTypedFunctionType(funcType)).to.be.true;
            expect(funcType.isAsync).to.be.true;
            expect(funcType.returnType.toString()).to.equal('dynamic');
            expect(funcType.awaitedReturnType.toString()).to.equal('string');
            expect(funcType.toString()).to.equal('async function getName() as string');
        });

        it('types the call of an async function as dynamic, and the await of it as the declared return type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                async function main()
                    promise = getName()
                    name = await getName()
                    count = await getCount()
                    result = await doWork()
                    untyped = await getUntyped()
                end function
                async function getName() as string
                    return "bob"
                end function
                async function getCount() as integer
                    return 1
                end function
                async sub doWork()
                end sub
                async function getUntyped()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getAssignmentType(file, 'promise').toString()).to.equal('dynamic');
            expect(getAssignmentType(file, 'name').toString()).to.equal('string');
            expect(getAssignmentType(file, 'count').toString()).to.equal('integer');
            expect(getAssignmentType(file, 'result').toString()).to.equal('invalid');
            expect(getAssignmentType(file, 'untyped').toString()).to.equal('dynamic');
        });

        it('types the await of an async class method as its declared return type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                class Person
                    async function getName() as string
                        return "bob"
                    end function
                end class
                async function main()
                    bob = new Person()
                    name = await bob.getName()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getAssignmentType(file, 'name').toString()).to.equal('string');
        });

        it('types the await of a non-promise primitive as that primitive, and everything else as dynamic', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                async function main(node as roSGNode)
                    a = await 1
                    b = await "text"
                    c = await invalid
                    d = await getName()
                    e = await node
                    f = await { name: "bob" }
                end function
                function getName() as string
                    return "bob"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getAssignmentType(file, 'a').toString()).to.equal('integer');
            expect(getAssignmentType(file, 'b').toString()).to.equal('string');
            expect(getAssignmentType(file, 'c').toString()).to.equal('invalid');
            expect(getAssignmentType(file, 'd').toString()).to.equal('string');
            expect(getAssignmentType(file, 'e').toString()).to.equal('dynamic');
            expect(getAssignmentType(file, 'f').toString()).to.equal('dynamic');
        });

        it('validates usage of an awaited value with its declared type', () => {
            program.setFile('source/main.bs', `
                async function main()
                    name = await getName()
                    takesInteger(name)
                end function
                async function getName() as string
                    return "bob"
                end function
                sub takesInteger(value as integer)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('allows passing the result of an async call to anything, since it is a promise', () => {
            program.setFile('source/main.bs', `
                sub main()
                    takesNode(getName())
                end sub
                async function getName() as string
                    return "bob"
                end function
                sub takesNode(value as roSGNode)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates return statements against the awaited return type', () => {
            program.setFile('source/main.bs', `
                async function getName() as string
                    return 1
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('integer', 'string').message
            ]);
        });

        it('allows returning the awaited value from an async function', () => {
            program.setFile('source/main.bs', `
                async function getName() as string
                    return await getOtherName()
                end function
                async function getOtherName() as string
                    return "bob"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows a bare return in an async sub', () => {
            program.setFile('source/main.bs', `
                async sub doWork()
                    return
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('transpile', () => {
        let rootDir = process.cwd();
        let program: Program;
        let testTranspile = getTestTranspile(() => [program, rootDir]);
        let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        it('keeps comments that are attached to the async keyword', async () => {
            await testTranspile(`
                'gets the user
                async function getUser()
                end function
            `, `
                'gets the user
                function getUser()
                    __bsc_scope = {}
                    return promises_try(function(__bsc_value, __bsc_scope)
                    end function, [invalid, __bsc_scope])
                end function
            `);
        });

        it('includes async in typedefs', async () => {
            await testGetTypedef(`
                async function getUser() as string
                    return "bob"
                end function
                async sub doWork()
                    print "working"
                end sub
                class Person
                    async function getName() as string
                        return "bob"
                    end function
                end class
            `, `
                async function getUser() as string
                end function
                async sub doWork()
                end sub
                class Person
                    sub new()
                    end sub
                    async function getName() as string
                    end function
                end class
            `);
        });

        it('parses async functions from a typedef', () => {
            program.setFile('source/lib.d.bs', `
                async function getUser() as string
                end function
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                async function main()
                    user = await getUser()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assignment = findAll<AssignmentStatement>(file.ast, isAssignmentStatement)[0];
            expect(assignment.value.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.equal('string');
        });
    });
});

