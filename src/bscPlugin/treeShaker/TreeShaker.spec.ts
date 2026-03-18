import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import * as fsExtra from 'fs-extra';
import undent from 'undent';

describe('TreeShakerValidator', () => {
    let program: Program;
    const tempDir = s`${__dirname}/../.tmp`;
    const rootDir = s`${tempDir}/rootDir`;
    const stagingDir = s`${tempDir}/stagingDir`;

    beforeEach(() => {
        fsExtra.emptyDirSync(rootDir);
        fsExtra.emptyDirSync(stagingDir);

        program = new Program({ rootDir: rootDir, stagingDir: stagingDir });
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

        it('can be disabled via treeShaking.enabled = false', async () => {
            program = new Program({ rootDir: rootDir, stagingDir: stagingDir, treeShaking: { enabled: false } });
            program.setFile('source/main.bs', `
                sub main()
                end sub

                sub unused()
                    print "I should survive"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub main()');
            expect(code).to.include('sub unused()');
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
                    treeShaking: { keep: ['unusedHelper'] }
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
                    treeShaking: { keep: ['utils_helper'] }
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
                    treeShaking: { keep: [{ functions: ['keepMe', 'alsoKeepMe'] }] }
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
                    treeShaking: { keep: [{ functions: ['UnusedHelper'] }] }
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
                    treeShaking: { keep: [{ matches: ['rodash_*'] }] }
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
                    treeShaking: { keep: [{ src: 'source/vendor/**/*' }] }
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
            it('keeps all functions in files matching the dest pkg path', async () => {
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { keep: [{ dest: 'source/vendor/**/*' }] }
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
                    treeShaking: { keep: ['topLevel'] }
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

        describe('invalid rule validation', () => {
            it('silently ignores object rules with no recognized fields', async () => {
                // An empty object has no src/dest/functions/matches — should be skipped
                program = new Program({
                    rootDir: rootDir, stagingDir: stagingDir,
                    treeShaking: { keep: [{} as any] }
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
