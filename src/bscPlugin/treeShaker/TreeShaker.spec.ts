import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import * as fsExtra from 'fs-extra';
import undent from 'undent';

describe('TreeShaker', () => {
    let program: Program;
    const tempDir = s`${__dirname}/../.tmp`;
    const rootDir = s`${tempDir}/rootDir`;
    const stagingDir = s`${tempDir}/stagingDir`;

    beforeEach(() => {
        fsExtra.emptyDirSync(rootDir);
        fsExtra.emptyDirSync(stagingDir);

        program = new Program({ rootDir: rootDir, stagingDir: stagingDir, treeShaking: { enabled: true } });
    });

    afterEach(() => {
        fsExtra.removeSync(tempDir);
    });

    async function getTranspiled(filePath: string) {
        program.validate();
        return (await program.getTranspiledFileContents(filePath)).code;
    }

    describe('tree shaking', () => {
        it('removes unused functions from transpiled output', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    doSomething()
                end sub

                sub doSomething()
                    print "used"
                end sub

                sub unusedFunction()
                    print "never called"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub doSomething()');
            expect(code).not.to.include('sub unusedFunction()');
        });

        it('preserves functions that are directly called', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    helper()
                end sub

                sub helper()
                    print "I am called"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub helper()');
        });

        it('preserves Roku lifecycle entry points', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub init()
                end sub

                sub onKeyEvent(key as string, press as boolean) as boolean
                    return false
                end sub

                sub runUserInterface()
                end sub

                sub runTask()
                end sub

                sub onMessage()
                end sub

                sub removable()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub main()');
            expect(code).to.include('sub init()');
            expect(code).to.include('sub onKeyEvent(');
            expect(code).to.include('sub runUserInterface()');
            expect(code).to.include('sub runTask()');
            expect(code).to.include('sub onMessage()');
            expect(code).not.to.include('sub removable()');
        });

        it('preserves functions with a bs:keep comment on the same line', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub mustStay() ' bs:keep
                    print "inline keep comment"
                end sub

                sub canGo()
                    print "no keep comment"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub mustStay()');
            expect(code).not.to.include('sub canGo()');
        });

        it('preserves functions with a bs:keep comment on the line above', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                ' bs:keep
                sub mustStay()
                    print "keep comment above"
                end sub

                sub canGo()
                    print "no keep comment"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub mustStay()');
            expect(code).not.to.include('sub canGo()');
        });

        it('preserves functions with a bs:keep comment anywhere between the previous function and this one', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                ' some description
                ' bs:keep
                ' another comment
                sub mustStay()
                    print "keep comment in header region"
                end sub

                sub canGo()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub mustStay()');
            expect(code).not.to.include('sub canGo()');
        });

        it('preserves the first function in a file with bs:keep (no previous function)', async () => {
            program.setFile('source/main.bs', `
                ' bs:keep
                sub firstFunction()
                    print "first function, no prev end line"
                end sub

                sub main()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub firstFunction()');
        });

        it('does not treat a bs:keep inside a function body as a header comment', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    ' bs:keep
                    print "comment inside body"
                end sub

                sub shouldBeRemoved()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).not.to.include('sub shouldBeRemoved()');
        });

        it('preserves a namespaced function with a bs:keep comment', async () => {
            program.setFile('source/main.bs', `
                namespace utils
                    ' bs:keep
                    sub keepMe()
                        print "namespaced, kept by comment"
                    end sub

                    sub removeMe()
                        print "namespaced, no keep"
                    end sub
                end namespace

                sub main()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('utils_keepMe');
            expect(code).not.to.include('utils_removeMe');
        });

        it('supports bs:keep with rem comment syntax', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                rem bs:keep
                sub mustStay()
                    print "kept via rem"
                end sub

                sub canGo()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub mustStay()');
            expect(code).not.to.include('sub canGo()');
        });

        it('preserves the full call chain of a bs:keep function', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                ' bs:keep
                sub topLevel()
                    middle()
                end sub

                sub middle()
                    leaf()
                end sub

                sub leaf()
                    print "end of chain"
                end sub

                sub unrelated()
                    print "no connection to topLevel"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub topLevel()');
            expect(code).to.include('sub middle()');
            expect(code).to.include('sub leaf()');
            expect(code).not.to.include('sub unrelated()');
        });

        it('does not apply a bs:keep comment to the function before it', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub shouldBeRemoved()
                    print "no keep"
                end sub

                ' bs:keep
                sub mustStay()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).not.to.include('sub shouldBeRemoved()');
            expect(code).to.include('sub mustStay()');
        });

        it('preserves a namespaced function passed by reference using its relative name from within the same namespace', async () => {
            // Inside namespace ns, `helper` is a relative reference to `ns.helper`.
            // allFunctions only stores 'ns.helper', so the VariableExpression gate must
            // also check allSimpleNames or it would miss the reference and remove ns.helper.
            program.setFile('source/main.bs', `
                namespace ns
                    sub init()
                        m.top.observeField("data", helper)
                    end sub

                    sub helper()
                        print "referenced relatively by name"
                    end sub
                end namespace

                sub main()
                    ns.init()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('ns_helper');
        });

        it('preserves a namespaced function passed by dotted reference from outside the namespace', async () => {
            // ns.helper appears as a DottedGetExpression, not a CallExpression.
            // The DottedGetExpression gate must check allFunctions.has(full) correctly.
            program.setFile('source/main.bs', `
                namespace ns
                    sub helper()
                        print "referenced by dotted get"
                    end sub
                end namespace

                sub main()
                    m.top.observeField("data", ns.helper)
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('ns_helper');
        });

        it('preserves functions referenced as string literals (observeField pattern)', async () => {
            program.setFile('source/main.bs', `
                sub init()
                    m.top.observeField("content", "onContentChanged")
                end sub

                sub onContentChanged()
                    print "content changed"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub onContentChanged()');
            expect(code).not.to.include('sub unused()');
        });

        it('preserves functions passed by reference as variables', async () => {
            program.setFile('source/main.bs', `
                sub init()
                    m.top.observeField("content", onContentChanged)
                end sub

                sub onContentChanged()
                    print "passed by reference"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub onContentChanged()');
            expect(code).not.to.include('sub unused()');
        });

        it('preserves functions called via @. callfunc shorthand', async () => {
            program.setFile('source/main.bs', `
                sub init()
                    m.someNode@.renderBlocks()
                end sub

                sub renderBlocks()
                    print "callfunc target"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub renderBlocks()');
            expect(code).not.to.include('sub unused()');
        });

        it('preserves a namespaced function called by its transpiled underscore name from a .brs file', async () => {
            // A plain .brs file has no namespaces — it calls utils_helper() directly.
            // calledNames receives "utils_helper" (underscore form), which matches neither
            // the bsName "utils.helper" nor the simpleName "helper". isUnused must also
            // check brsName or the function is incorrectly removed.
            program.setFile('source/utils.bs', `
                namespace utils
                    sub helper()
                        print "called from brs"
                    end sub
                end namespace
            `);
            program.setFile('source/main.brs', `
                sub main()
                    utils_helper()
                end sub
            `);

            const code = await getTranspiled('source/utils.bs');
            expect(code).to.include('utils_helper');
        });

        it('preserves a namespaced function called relatively (without namespace prefix) from within the same namespace', async () => {
            program.setFile('source/main.bs', `
                namespace utils
                    sub caller()
                        helper() ' relative call — no "utils." prefix
                    end sub

                    sub helper()
                        print "called relatively from within the namespace"
                    end sub
                end namespace

                sub main()
                    utils.caller()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('utils_caller');
            expect(code).to.include('utils_helper');
        });

        it('conservatively preserves all same-named functions across namespaces when one is called relatively', async () => {
            // When `helper()` is called relatively inside `ns1`, the AST contains only
            // the simple name "helper". The shaker adds "helper" to calledNames, which
            // causes ns2_helper to survive even though it was never actually called.
            // This is safe (no false removals) but not maximally precise.
            program.setFile('source/main.bs', `
                namespace ns1
                    sub caller()
                        helper() ' relative call — resolves to ns1_helper at runtime
                    end sub

                    sub helper()
                        print "ns1 helper"
                    end sub
                end namespace

                namespace ns2
                    sub helper()
                        print "ns2 helper — conservatively kept due to simple name match"
                    end sub
                end namespace

                sub main()
                    ns1.caller()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('ns1_caller');
            expect(code).to.include('ns1_helper');
            // ns2_helper is kept as a conservative side-effect of the simple name "helper"
            // being in calledNames — not a bug, just imprecision in the static analysis.
            expect(code).to.include('ns2_helper');
        });

        it('preserves namespaced functions that are called', async () => {
            program.setFile('source/main.bs', `
                namespace utils
                    sub helper()
                        print "namespaced helper"
                    end sub

                    sub unused()
                        print "namespaced but never called"
                    end sub
                end namespace

                sub main()
                    utils.helper()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('utils_helper');
            expect(code).not.to.include('utils_unused');
        });

        it('removes multiple unused functions in a single file', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub unusedA()
                end sub

                sub unusedB()
                end sub

                sub unusedC()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub main()');
            expect(code).not.to.include('sub unusedA()');
            expect(code).not.to.include('sub unusedB()');
            expect(code).not.to.include('sub unusedC()');
        });

        it('preserves functions across files when called from another file', async () => {
            program.setFile('source/utils.bs', `
                sub utilHelper()
                    print "used from main"
                end sub

                sub unusedUtil()
                    print "never called"
                end sub
            `);
            program.setFile('source/main.bs', `
                sub main()
                    utilHelper()
                end sub
            `);

            const utilCode = await getTranspiled('source/utils.bs');
            expect(utilCode).to.include('sub utilHelper()');
            expect(utilCode).not.to.include('sub unusedUtil()');
        });

        it('preserves function keyword declarations (not just sub)', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    print compute()
                end sub

                function compute() as integer
                    return 42
                end function

                function unused() as integer
                    return 0
                end function
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('function compute()');
            expect(code).not.to.include('function unused()');
        });

        it('preserves indirect callees via a call chain (main → A → B)', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    stepA()
                end sub

                sub stepA()
                    stepB()
                end sub

                sub stepB()
                    print "end of chain"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub stepA()');
            expect(code).to.include('sub stepB()');
            expect(code).not.to.include('sub unused()');
        });

        it('conservatively preserves a function called only from dead code', async () => {
            // The reference pass walks ALL bodies including dead ones, so callee of
            // a dead function ends up in calledNames and is kept. This is intentional
            // conservative behaviour — it avoids false removals at the cost of a
            // slightly larger output.
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub deadCaller()
                    calledFromDead()
                end sub

                sub calledFromDead()
                    print "kept because reference pass sees the call in deadCaller"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).not.to.include('sub deadCaller()');
            expect(code).to.include('sub calledFromDead()');
        });

        it('is disabled by default — unused functions are preserved when treeShaking is not configured', async () => {
            program = new Program({ rootDir: rootDir, stagingDir: stagingDir });
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub unused()
                    print "I should survive when tree shaking is off"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub main()');
            expect(code).to.include('sub unused()');
        });

        it('must be explicitly enabled via treeShaking.enabled = true', async () => {
            program = new Program({ rootDir: rootDir, stagingDir: stagingDir, treeShaking: { enabled: true } });
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub unused()
                    print "I should be removed when tree shaking is on"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub main()');
            expect(code).not.to.include('sub unused()');
        });
    });

    describe('XML interface functions', () => {
        it('preserves functions declared in XML <interface><function> elements', async () => {
            program.setFile('components/MyComponent.xml', undent`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComponent" extends="Group">
                    <interface>
                        <function name="exposedToParent"/>
                    </interface>
                    <script type="text/brightscript" uri="MyComponent.bs"/>
                </component>
            `);
            program.setFile('components/MyComponent.bs', `
                sub init()
                end sub

                sub exposedToParent()
                    print "called from parent via interface"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('components/MyComponent.bs');
            expect(code).to.include('sub exposedToParent()');
            expect(code).not.to.include('sub unused()');
        });

        it('preserves functions referenced in XML field onChange attributes', async () => {
            program.setFile('components/MyComponent.xml', undent`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComponent" extends="Group">
                    <interface>
                        <field id="content" type="string" onChange="onContentChanged"/>
                    </interface>
                    <script type="text/brightscript" uri="MyComponent.bs"/>
                </component>
            `);
            program.setFile('components/MyComponent.bs', `
                sub init()
                end sub

                sub onContentChanged()
                    print "field observer"
                end sub

                sub unused()
                end sub
            `);

            const code = await getTranspiled('components/MyComponent.bs');
            expect(code).to.include('sub onContentChanged()');
            expect(code).not.to.include('sub unused()');
        });
    });

    describe('treeShaking.keep rules', () => {
        describe('plain string entry', () => {
            it('keeps a function matched by exact BrightScript name', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: ['unusedHelper'] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub unusedHelper()
                        print "kept by string rule"
                    end sub

                    sub alsoUnused()
                        print "not in keep list"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub unusedHelper()');
                expect(code).not.to.include('sub alsoUnused()');
            });

            it('keeps a namespaced function matched by BrightScript transpiled name', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: ['utils_helper'] }
                });
                program.setFile('source/main.bs', `
                    namespace utils
                        sub helper()
                            print "kept"
                        end sub

                        sub gone()
                            print "removed"
                        end sub
                    end namespace

                    sub main()
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('utils_helper');
                expect(code).not.to.include('utils_gone');
            });
        });

        describe('functions rule', () => {
            it('keeps functions matched by exact name in functions array', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ functions: ['keepMe', 'alsoKeepMe'] }] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub keepMe()
                        print "kept"
                    end sub

                    sub alsoKeepMe()
                        print "also kept"
                    end sub

                    sub removeMe()
                        print "removed"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub keepMe()');
                expect(code).to.include('sub alsoKeepMe()');
                expect(code).not.to.include('sub removeMe()');
            });

            it('is case-insensitive for function names', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ functions: ['UnusedHelper'] }] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub unusedHelper()
                        print "kept despite case difference"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub unusedHelper()');
            });
        });

        describe('matches rule', () => {
            it('keeps functions matching a wildcard pattern', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ matches: ['rodash_*'] }] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub rodash_tostring()
                        print "matched by wildcard"
                    end sub

                    sub rodash_isarray()
                        print "also matched"
                    end sub

                    sub unrelated()
                        print "removed"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub rodash_tostring()');
                expect(code).to.include('sub rodash_isarray()');
                expect(code).not.to.include('sub unrelated()');
            });
        });

        describe('src rule', () => {
            it('keeps all functions in files matching the src glob', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ src: 'source/vendor/**/*' }] }
                });
                program.setFile('source/vendor/lib.bs', `
                    sub vendorHelper()
                        print "from vendor"
                    end sub

                    sub anotherVendorFn()
                        print "also from vendor"
                    end sub
                `);
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub appHelper()
                        print "app code - removed"
                    end sub
                `);

                const vendorCode = await getTranspiled('source/vendor/lib.bs');
                const mainCode = await getTranspiled('source/main.bs');

                expect(vendorCode).to.include('sub vendorHelper()');
                expect(vendorCode).to.include('sub anotherVendorFn()');
                expect(mainCode).not.to.include('sub appHelper()');
            });
        });

        describe('dest rule', () => {
            it('keeps all functions in files matching the dest glob using the transpiled .brs extension', async () => {
                // .bs source files deploy as .brs — dest patterns must use .brs to match
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ dest: 'source/vendor/**/*.brs' }] }
                });
                program.setFile('source/vendor/lib.bs', `
                    sub vendorHelper()
                        print "from vendor"
                    end sub
                `);
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub appHelper()
                        print "app code - removed"
                    end sub
                `);

                const vendorCode = await getTranspiled('source/vendor/lib.bs');
                const mainCode = await getTranspiled('source/main.bs');

                expect(vendorCode).to.include('sub vendorHelper()');
                expect(mainCode).not.to.include('sub appHelper()');
            });

            it('accepts a pkg:/ prefix in dest patterns and strips it before matching', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ dest: 'pkg:/source/vendor/**/*.brs' }] }
                });
                program.setFile('source/vendor/lib.bs', `
                    sub vendorHelper()
                        print "from vendor"
                    end sub
                `);
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub appHelper()
                        print "app code - removed"
                    end sub
                `);

                const vendorCode = await getTranspiled('source/vendor/lib.bs');
                const mainCode = await getTranspiled('source/main.bs');

                expect(vendorCode).to.include('sub vendorHelper()');
                expect(mainCode).not.to.include('sub appHelper()');
            });
        });

        describe('combined AND rule', () => {
            it('keeps only functions satisfying ALL fields in a single rule', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: {
                        enabled: true,
                        keep: [{ src: 'source/lib.bs', functions: ['specialFn'] }]
                    }
                });
                // specialFn in lib.bs — should be kept (matches both src AND functions)
                program.setFile('source/lib.bs', `
                    sub specialFn()
                        print "kept — matches src AND functions"
                    end sub

                    sub otherFn()
                        print "removed — matches src but not functions"
                    end sub
                `);
                // specialFn in main.bs — should NOT be kept (matches functions but not src)
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub specialFn()
                        print "removed — matches functions but not src"
                    end sub
                `);

                const libCode = await getTranspiled('source/lib.bs');
                const mainCode = await getTranspiled('source/main.bs');

                expect(libCode).to.include('sub specialFn()');
                expect(libCode).not.to.include('sub otherFn()');
                expect(mainCode).not.to.include('sub specialFn()');
            });
        });

        describe('OR semantics across rules', () => {
            it('keeps a function that matches any one of multiple rules', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: {
                        enabled: true,
                        keep: [
                            { functions: ['keepByName'] },
                            { matches: ['keepBy*'] }
                        ]
                    }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub keepByName()
                        print "kept by first rule"
                    end sub

                    sub keepByWildcard()
                        print "kept by second rule"
                    end sub

                    sub removeMe()
                        print "matches neither rule"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub keepByName()');
                expect(code).to.include('sub keepByWildcard()');
                expect(code).not.to.include('sub removeMe()');
            });
        });

        describe('scoped keep with same function name across files', () => {
            it('only keeps the function in the matching source file', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: {
                        enabled: true,
                        keep: [{ src: 'source/lib.bs', functions: ['sharedName'] }]
                    }
                });
                program.setFile('source/lib.bs', `
                    sub sharedName()
                        print "in lib — kept"
                    end sub
                `);
                program.setFile('source/other.bs', `
                    sub sharedName()
                        print "in other — removed"
                    end sub
                `);
                program.setFile('source/main.bs', `
                    sub main()
                    end sub
                `);

                const libCode = await getTranspiled('source/lib.bs');
                const otherCode = await getTranspiled('source/other.bs');

                expect(libCode).to.include('sub sharedName()');
                expect(otherCode).not.to.include('sub sharedName()');
            });
        });

        describe('dependency closure', () => {
            it('preserves transitive callees of a kept function', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: ['topLevel'] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub topLevel()
                        innerHelper()
                    end sub

                    sub innerHelper()
                        print "required by topLevel"
                    end sub

                    sub unrelated()
                        print "no connection to topLevel"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub topLevel()');
                expect(code).to.include('sub innerHelper()');
                expect(code).not.to.include('sub unrelated()');
            });
        });

        describe('matches with multiple patterns', () => {
            it('keeps functions matching any pattern in the matches array', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ matches: ['foo_*', 'bar_*'] }] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub foo_helper()
                        print "matches foo_*"
                    end sub

                    sub bar_helper()
                        print "matches bar_*"
                    end sub

                    sub baz_helper()
                        print "matches neither"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).to.include('sub foo_helper()');
                expect(code).to.include('sub bar_helper()');
                expect(code).not.to.include('sub baz_helper()');
            });
        });

        describe('src with array of globs', () => {
            it('keeps functions from any matching source path', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{ src: ['source/libA.bs', 'source/libB.bs'] }] }
                });
                program.setFile('source/libA.bs', `
                    sub fromA()
                    end sub
                `);
                program.setFile('source/libB.bs', `
                    sub fromB()
                    end sub
                `);
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub appOnly()
                    end sub
                `);

                const codeA = await getTranspiled('source/libA.bs');
                const codeB = await getTranspiled('source/libB.bs');
                const mainCode = await getTranspiled('source/main.bs');

                expect(codeA).to.include('sub fromA()');
                expect(codeB).to.include('sub fromB()');
                expect(mainCode).not.to.include('sub appOnly()');
            });
        });

        describe('empty keep list', () => {
            it('still tree shakes normally when keep is an empty array', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub unused()
                        print "should still be removed"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).not.to.include('sub unused()');
            });
        });

        describe('invalid rule validation', () => {
            it('silently ignores object rules with no recognized fields', async () => {
                // An empty object has no src/dest/functions/matches — should be skipped
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { enabled: true, keep: [{} as any] }
                });
                program.setFile('source/main.bs', `
                    sub main()
                    end sub

                    sub unused()
                        print "still removed — empty rule is a no-op"
                    end sub
                `);

                const code = await getTranspiled('source/main.bs');
                expect(code).not.to.include('sub unused()');
            });
        });
    });
});
