import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { ParseMode, Parser } from '../../parser/Parser';
import { expectZeroDiagnostics, getTestTranspile } from '../../testHelpers.spec';
import { isFunctionExpression } from '../../astUtils/reflection';
import { WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { FunctionExpression } from '../../parser/Expression';
import type { AstNode } from '../../parser/AstNode';

describe('AsyncFunctionTranspiler', () => {
    let rootDir = process.cwd();
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        //the async functions the tests call
        program.setFile('source/lib.bs', `
            function getUserAsync() as dynamic
            end function
            function getNameAsync(user) as dynamic
            end function
        `);
    });
    afterEach(() => {
        program.dispose();
    });

    it('wraps a function with no awaits so it still returns a promise', async () => {
        await testTranspile(`
            async function getUser()
                print "loading"
                return 1
            end function
        `, `
            function getUser()
                __bsc_scope = {}
                return promises_try(function(__bsc_value, __bsc_scope)
                    print "loading"
                    return 1
                end function, [invalid, __bsc_scope])
            end function
        `);
    });

    it('lowers the example from the issue', async () => {
        program.setFile('source/auth.bs', `
            function getUsernameAsync() as dynamic
            end function
            function promptForPassword(username) as dynamic
            end function
            function requestAuthToken(username, password) as dynamic
            end function
        `);
        await testTranspile(`
            'gets the token
            async function getAuthToken()
                try
                    username = await getUsernameAsync()
                    password = await promptForPassword(username)
                    authToken = await requestAuthToken(username, password)
                    return authToken
                catch e
                    print e
                end try
            end function
        `, `
            'gets the token
            function getAuthToken()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return getUsernameAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.username = __bsc_value
                    return promptForPassword(__bsc_scope.username)
                end function).then(function(__bsc_value, __bsc_scope)
                    password = __bsc_value
                    return requestAuthToken(__bsc_scope.username, password)
                end function).then(function(__bsc_value, __bsc_scope)
                    authToken = __bsc_value
                    return authToken
                end function).catch(function(e, __bsc_scope)
                    print e
                end function).toPromise()
            end function
        `);
    });

    it('moves parameters, shared variables, and m to the scope, and removes the return type', async () => {
        await testTranspile(`
            async function getToken(prefix as string, unused) as string
                print "start"
                m.count = 1
                user = await getUserAsync()
                m.user = await getUserAsync()
                return await getNameAsync(prefix + user)
            end function
        `, `
            function getToken(prefix as string, unused)
                __bsc_scope = {
                    m: m
                    prefix: prefix
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    print "start"
                    __bsc_scope.m.count = 1
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.user = __bsc_value
                    return getUserAsync()
                end function).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.m.user = __bsc_value
                    return getNameAsync(__bsc_scope.prefix + __bsc_scope.user)
                end function).toPromise()
            end function
        `);
    });

    it('keeps variables that are only used in one callback as locals', async () => {
        await testTranspile(`
            async function main()
                a = 1
                print a
                b = await getUserAsync()
                c = b + 1
                print c
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    a = 1
                    print a
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    b = __bsc_value
                    c = b + 1
                    print c
                end function).toPromise()
            end function
        `);
    });

    it('awaits into indexes, and discards standalone awaits', async () => {
        await testTranspile(`
            async sub main()
                m.users["bob"] = await getUserAsync()
                m.users[m.index] = await getUserAsync()
                await getUserAsync()
            end sub
        `, `
            function main()
                __bsc_scope = {
                    m: m
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.m.users["bob"] = __bsc_value
                    return getUserAsync()
                end function).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.m.users[__bsc_scope.m.index] = __bsc_value
                    return getUserAsync()
                end function).toPromise()
            end function
        `);
    });

    it('skips the remaining callbacks after an early return, and gives an empty return a value', async () => {
        await testTranspile(`
            async sub doWork(flag)
                if flag then return
                await getUserAsync()
                print "done"
            end sub
        `, `
            function doWork(flag)
                __bsc_scope = {
                    flag: flag
                    __bsc_returned: false
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    if __bsc_scope.flag then
                        __bsc_scope.__bsc_returned = true
                        return invalid
                    end if
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    if __bsc_scope.__bsc_returned then
                        return __bsc_value
                    end if
                    print "done"
                end function).toPromise()
            end function
        `);
    });

    it('does not track returns when nothing runs after them', async () => {
        await testTranspile(`
            async function main(flag)
                user = await getUserAsync()
                if flag then
                    return 1
                end if
                return user
            end function
        `, `
            function main(flag)
                __bsc_scope = {
                    flag: flag
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    user = __bsc_value
                    if __bsc_scope.flag then
                        return 1
                    end if
                    return user
                end function).toPromise()
            end function
        `);
    });

    it('tracks a return inside a try that has more code after it', async () => {
        await testTranspile(`
            async function main()
                try
                    user = await getUserAsync()
                    return user
                catch e
                    return invalid
                end try
                print "the try did not return"
            end function
        `, `
            function main()
                __bsc_scope = {
                    __bsc_returned: false
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                        return getUserAsync()
                    end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                        if __bsc_scope.__bsc_returned then
                            return __bsc_value
                        end if
                        user = __bsc_value
                        __bsc_scope.__bsc_returned = true
                        return user
                    end function).catch(function(e, __bsc_scope)
                        __bsc_scope.__bsc_returned = true
                        return invalid
                    end function).toPromise()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    if __bsc_scope.__bsc_returned then
                        return __bsc_value
                    end if
                    print "the try did not return"
                end function).toPromise()
            end function
        `);
    });

    it('continues after a try, and shares the catch variable when it is used later', async () => {
        await testTranspile(`
            async function main()
                print "before"
                try
                    user = await getUserAsync()
                catch e
                    print "failed"
                end try
                print e, user
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    print "before"
                    return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                        return getUserAsync()
                    end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                        __bsc_scope.user = __bsc_value
                    end function).catch(function(e, __bsc_scope)
                        __bsc_scope.e = e
                        print "failed"
                    end function).toPromise()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    print __bsc_scope.e, __bsc_scope.user
                end function).toPromise()
            end function
        `);
    });

    it('nests the chain of a try inside another try', async () => {
        await testTranspile(`
            async function main()
                try
                    a = await getUserAsync()
                    try
                        b = await getUserAsync()
                    catch inner
                        print inner
                    end try
                    print a, b
                catch outer
                    print outer
                end try
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.a = __bsc_value
                    return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                        return getUserAsync()
                    end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                        __bsc_scope.b = __bsc_value
                    end function).catch(function(inner, __bsc_scope)
                        print inner
                    end function).toPromise()
                end function).then(function(__bsc_value, __bsc_scope)
                    print __bsc_scope.a, __bsc_scope.b
                end function).catch(function(outer, __bsc_scope)
                    print outer
                end function).toPromise()
            end function
        `);
    });

    it('leaves a try that does not await alone', async () => {
        await testTranspile(`
            async function main()
                try
                    print "a"
                catch e
                    print e
                end try
                x = await getUserAsync()
                print x
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    try
                        print "a"
                    catch e
                        print e
                    end try
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    x = __bsc_value
                    print x
                end function).toPromise()
            end function
        `);
    });

    it('lowers nested async functions on their own, and leaves nested non-async functions alone', async () => {
        await testTranspile(`
            async function main()
                callback = function()
                    print m.name
                    x = 1
                    return x
                end function
                inner = async function(value)
                    return await getUserAsync()
                end function
                x = await inner(1)
                print x
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    callback = function()
                        print m.name
                        x = 1
                        return x
                    end function
                    inner = function(value)
                        __bsc_scope = {}
                        return promises_try(function(__bsc_value, __bsc_scope)
                            return getUserAsync()
                        end function, [invalid, __bsc_scope])
                    end function
                    return inner(1)
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    x = __bsc_value
                    print x
                end function).toPromise()
            end function
        `);
    });

    it('copies loop variables and dim arrays into the scope', async () => {
        await testTranspile(`
            async function main(items)
                for each item in items
                    print item
                end for
                for i = 0 to 2
                    print i
                end for
                dim grid[2]
                await getUserAsync()
                print item, i, grid
            end function
        `, `
            function main(items)
                __bsc_scope = {
                    items: items
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    for each item in __bsc_scope.items
                        __bsc_scope.item = item
                        print __bsc_scope.item
                    end for
                    for i = 0 to 2
                        __bsc_scope.i = i
                        print __bsc_scope.i
                    end for
                    __bsc_scope.i = i
                    dim grid[2]
                    __bsc_scope.grid = grid
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    print __bsc_scope.item, __bsc_scope.i, __bsc_scope.grid
                end function).toPromise()
            end function
        `);
    });

    it('keeps comments with the code they describe', async () => {
        await testTranspile(`
            async function main()
                'before
                print "a" 'trailing
                'above await
                x = await getUserAsync()
                'after
                return x
            end function
        `, `
            function main()
                __bsc_scope = {}
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    'before
                    print "a" 'trailing
                    'above await
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    x = __bsc_value
                    'after
                    return x
                end function).toPromise()
            end function
        `);
    });

    it('lowers async class methods, including super calls', async () => {
        await testTranspile(`
            class Base
                function getName()
                    return "base"
                end function
            end class
            class Person extends Base
                name as string
                override async function getName()
                    m.name = await getUserAsync()
                    return super.getName() + m.name
                end function
            end class
        `, `
            sub __Base_method_new()
            end sub
            function __Base_method_getName()
                return "base"
            end function
            function __Base_builder()
                instance = {}
                instance.new = __Base_method_new
                instance.getName = __Base_method_getName
                return instance
            end function
            function Base()
                instance = __Base_builder()
                instance.new()
                return instance
            end function
            sub __Person_method_new()
                m.super0_new()
                m.name = invalid
            end sub
            function __Person_method_getName()
                __bsc_scope = {
                    m: m
                }
                return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
                    return getUserAsync()
                end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
                    __bsc_scope.m.name = __bsc_value
                    return __bsc_scope.m.super0_getName() + __bsc_scope.m.name
                end function).toPromise()
            end function
            function __Person_builder()
                instance = __Base_builder()
                instance.super0_new = instance.new
                instance.new = __Person_method_new
                instance.super0_getName = instance.getName
                instance.getName = __Person_method_getName
                return instance
            end function
            function Person()
                instance = __Person_builder()
                instance.new()
                return instance
            end function
        `);
    });

    it('uses the prefix of the non-aliased ropm copy of the promises library', async () => {
        program.setFile('source/roku_modules/rokucommunity_promises/promises.brs', `
            function rokucommunity_promises_try(callback, args)
            end function
        `);
        await testTranspile(`
            async function main()
                return 1
            end function
        `, `
            function main()
                __bsc_scope = {}
                return rokucommunity_promises_try(function(__bsc_value, __bsc_scope)
                    return 1
                end function, [invalid, __bsc_scope])
            end function
        `);
    });

    it('produces valid BrightScript', async () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            async function main(items, flag)
                for each item in items
                    print item
                end for
                if flag then return invalid
                try
                    user = await getUserAsync()
                    m.name = await getNameAsync(user)
                catch e
                    print e
                    return invalid
                end try
                return await getNameAsync(item)
            end function
        `);
        program.validate();
        expectZeroDiagnostics(program);
        const result = await program.getTranspiledFileContents(file.srcPath);
        const { diagnostics } = Parser.parse(result.code, { mode: ParseMode.BrightScript });
        expectZeroDiagnostics(diagnostics);
    });

    it('restores the original AST after transpiling', async () => {
        const source = `
            async function main(flag)
                if flag then return invalid
                try
                    user = await getUserAsync()
                catch e
                    print e
                end try
                print user
            end function
        `;
        const file = program.setFile<BrsFile>('source/main.bs', source);
        program.validate();
        expectZeroDiagnostics(program);
        const first = await program.getTranspiledFileContents(file.srcPath);

        //every node points back at its original parent
        const func = file.ast.findChild<FunctionExpression>(isFunctionExpression);
        expect(func.isAsync).to.be.true;
        expect(func.body.parent).to.equal(func);
        func.body.walk((node: AstNode, parent: AstNode) => {
            expect(node.parent).to.equal(parent);
        }, { walkMode: WalkMode.visitAllRecursive });
        for (const statement of func.body.statements) {
            expect(statement.parent).to.equal(func.body);
        }

        //validation still sees the original async function
        program.setFile('source/other.bs', '');
        program.validate();
        expectZeroDiagnostics(program);

        //and transpiling again produces the same result
        const second = await program.getTranspiledFileContents(file.srcPath);
        expect(second.code).to.eql(first.code);
    });
});
