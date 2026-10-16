import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { getTestTranspile } from '../../testHelpers.spec';
import { tempDir, rootDir, outDir } from '../../testHelpers.spec';

describe('with statement', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            outDir: outDir
        });
    });
    afterEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    it('uses a plain variable target directly and drops the block', async () => {
        await testTranspile(`
            sub main(customer as object)
                with customer
                    .name = "Coho Vineyard"
                    .url = "http://www.cohovineyard.com/"
                    .city = "Redmond"
                end with
            end sub
        `, `
            sub main(customer as object)
                customer.name = "Coho Vineyard"
                customer.url = "http://www.cohovineyard.com/"
                customer.city = "Redmond"
            end sub
        `);
    });

    it('evaluates any other target once into a local', async () => {
        await testTranspile(`
            sub main()
                with m.customer
                    .name = "Coho Vineyard"
                    .city = "Redmond"
                end with
            end sub
        `, `
            sub main()
                __bsc_tmp_with0 = m.customer
                __bsc_tmp_with0.name = "Coho Vineyard"
                __bsc_tmp_with0.city = "Redmond"
            end sub
        `);
    });

    it('rewrites leading-dot members in every expression position', async () => {
        await testTranspile(`
            sub main(user as object)
                with user
                    .loginCount++
                    .score += 10
                    .save()
                    .fullName = .firstName + .lastName
                    .send(.email, .name)
                    .isAdmin = not .isGuest
                    .item = .items[0]
                    .nested = .child.grandchild
                    .result = .lookup("key").value
                end with
            end sub
        `, `
            sub main(user as object)
                user.loginCount++
                user.score += 10
                user.save()
                user.fullName = user.firstName + user.lastName
                user.send(user.email, user.name)
                user.isAdmin = not user.isGuest
                user.item = user.items[0]
                user.nested = user.child.grandchild
                user.result = user.lookup("key").value
            end sub
        `);
    });

    it('rewrites a leading `.[` into an index on the target', async () => {
        await testTranspile(`
            sub main()
                arr = []
                with arr
                    .[0] = "First slot"
                    .[1] = "Second slot"
                end with
                with m.grid
                    .[0].title = .[1]
                end with
            end sub
        `, `
            sub main()
                arr = []
                arr[0] = "First slot"
                arr[1] = "Second slot"
                __bsc_tmp_with0 = m.grid
                __bsc_tmp_with0[0].title = __bsc_tmp_with0[1]
            end sub
        `);
    });

    it('keeps optional chaining on leading-dot members', async () => {
        await testTranspile(`
            sub main(myClass)
                with myClass
                    .doSomething?()
                    .c = .d?.e
                    .f = .g?.[0]
                    .h?.i?.j()
                    .k = .l?@m
                end with
                with m.thing
                    .doSomething?()
                end with
            end sub
        `, `
            sub main(myClass)
                myClass.doSomething?()
                myClass.c = myClass.d?.e
                myClass.f = myClass.g?.[0]
                myClass.h?.i?.j()
                myClass.k = myClass.l?@m
                __bsc_tmp_with0 = m.thing
                __bsc_tmp_with0.doSomething?()
            end sub
        `);
    });

    it('transpiles namespaced targets to their flattened names', async () => {
        await testTranspile(`
            namespace promises
                const DEFAULTS = { timeout: 1 }
                function chain() as object
                    return {}
                end function
                sub useRelative()
                    with chain()
                        .then()
                    end with
                end sub
            end namespace
            sub main()
                with promises.chain()
                    .then()
                    .then()
                end with
                with promises.DEFAULTS
                    .timeout = 2
                end with
            end sub
        `, `
            function promises_chain() as object
                return {}
            end function

            sub promises_useRelative()
                __bsc_tmp_with0 = promises_chain()
                __bsc_tmp_with0.then()
            end sub

            sub main()
                __bsc_tmp_with0 = promises_chain()
                __bsc_tmp_with0.then()
                __bsc_tmp_with0.then()
                __bsc_tmp_with0 = ({
                    timeout: 1
                })
                __bsc_tmp_with0.timeout = 2
            end sub
        `);
    });

    it('lets a nested block target a member of the outer block', async () => {
        await testTranspile(`
            sub main(order as object)
                with order
                    .id = 123
                    with .customer
                        .name = "Ann"
                        .city = "Redmond"
                    end with
                    .total = 99.5
                end with
            end sub
        `, `
            sub main(order as object)
                order.id = 123
                __bsc_tmp_with0 = order.customer
                __bsc_tmp_with0.name = "Ann"
                __bsc_tmp_with0.city = "Redmond"
                order.total = 99.5
            end sub
        `);
    });

    it('gives nested blocks that both need a local distinct names', async () => {
        await testTranspile(`
            sub main()
                with m.order
                    .id = 123
                    with .customer
                        .name = "Ann"
                    end with
                    .total = 99.5
                end with
            end sub
        `, `
            sub main()
                __bsc_tmp_with0 = m.order
                __bsc_tmp_with0.id = 123
                __bsc_tmp_with1 = __bsc_tmp_with0.customer
                __bsc_tmp_with1.name = "Ann"
                __bsc_tmp_with0.total = 99.5
            end sub
        `);
    });

    it('reuses the local for sibling blocks', async () => {
        await testTranspile(`
            sub main()
                with m.a
                    .x = 1
                end with
                with m.b
                    .x = 2
                end with
            end sub
        `, `
            sub main()
                __bsc_tmp_with0 = m.a
                __bsc_tmp_with0.x = 1
                __bsc_tmp_with0 = m.b
                __bsc_tmp_with0.x = 2
            end sub
        `);
    });

    it('supports complex target expressions', async () => {
        await testTranspile(`
            sub main(a as object, b as object)
                with createObject("roSGNode", "Label")
                    .text = "hi"
                end with
                with (a ?? b)
                    .x = 1
                end with
                with m.top.findNode("label").font
                    .size = 24
                end with
            end sub
        `, `
            sub main(a as object, b as object)
                __bsc_tmp_with0 = createObject("roSGNode", "Label")
                __bsc_tmp_with0.text = "hi"
                __bsc_tmp_with0 = (bslib_coalesce(a, b))
                __bsc_tmp_with0.x = 1
                __bsc_tmp_with0 = m.top.findNode("label").font
                __bsc_tmp_with0.size = 24
            end sub
        `);
    });

    it('keeps the body at the indentation of the enclosing block', async () => {
        await testTranspile(`
            sub main(c as object)
                if c <> invalid
                    with c
                        .a = 1
                        with .b
                            .c = 2
                        end with
                    end with
                end if
            end sub
        `, `
            sub main(c as object)
                if c <> invalid
                    c.a = 1
                    __bsc_tmp_with0 = c.b
                    __bsc_tmp_with0.c = 2
                end if
            end sub
        `);
    });

    it('supports the single-line colon form', async () => {
        await testTranspile(`
            sub main(c as object)
                with c: .a = 1: .b = 2: end with
            end sub
        `, `
            sub main(c as object)
                c.a = 1
                c.b = 2
            end sub
        `);
    });

    it('preserves comments when the target is lifted into a local', async () => {
        await testTranspile(`
            sub main()
                'before the block
                with m.c 'on the with line
                    'own line in the body
                    .a = 1 'after a statement
                    .b = 2
                end with 'after end with
                print "done"
            end sub
        `, `
            sub main()
                'before the block
                __bsc_tmp_with0 = m.c 'on the with line
                'own line in the body
                __bsc_tmp_with0.a = 1 'after a statement
                __bsc_tmp_with0.b = 2 'after end with
                print "done"
            end sub
        `);
    });

    it('preserves comments when the target is a plain variable', async () => {
        await testTranspile(`
            sub main(c as object)
                'before the block
                with c 'on the with line
                    'own line in the body
                    .a = 1 'after a statement
                    .b = 2
                end with 'after end with
                print "done"
            end sub
        `, `
            sub main(c as object)
                'before the block
                'on the with line
                'own line in the body
                c.a = 1 'after a statement
                c.b = 2 'after end with
                print "done"
            end sub
        `);
    });

    it('keeps a comment that sits just above `end with`', async () => {
        await testTranspile(`
            sub main(c as object)
                with c
                    .a = 1
                    'just above end with
                end with
                print "done"
            end sub
        `, `
            sub main(c as object)
                c.a = 1
                'just above end with
                print "done"
            end sub
        `);
    });

    it('places the continue label of an enclosing loop after the with body', async () => {
        program = new Program({
            rootDir: rootDir,
            outDir: outDir,
            minFirmwareVersion: '11.0.0'
        });
        await testTranspile(`
            sub main(items as object)
                for each item in items
                    with item
                        .done = true
                    end with
                    if item.skip then continue for
                    print "after"
                end for
            end sub
        `, `
            sub main(items as object)
                for each item in items
                    item.done = true
                    if item.skip then
                        goto BRIGHTERSCRIPT_CONTINUE_0
                    end if
                    print "after"
                    BRIGHTERSCRIPT_CONTINUE_0:
                end for
            end sub
        `);
    });

    it('leaves `with` alone when it is used as an identifier', async () => {
        await testTranspile(`
            sub main()
                with = {}
                with.foo = 1
                with["bar"] = 2
                print with.foo
            end sub
        `);
    });
});
