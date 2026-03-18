import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import * as fsExtra from 'fs-extra';
import undent from 'undent';

describe.only('TreeShakerValidator', () => {
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

        it('preserves @keep annotated functions regardless of call sites', async () => {
            program.setFile('source/main.bs', `
                sub main()
                end sub

                @keep
                sub mustStay()
                    print "annotated with keep"
                end sub

                sub canGo()
                    print "no annotation"
                end sub
            `);

            const code = await getTranspiled('source/main.bs');
            expect(code).to.include('sub mustStay()');
            expect(code).not.to.include('sub canGo()');
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
});
