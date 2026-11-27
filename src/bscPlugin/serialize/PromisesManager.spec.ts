import * as fsExtra from 'fs-extra';
import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir, outDir, trim, expectDiagnostics, expectZeroDiagnostics } from '../../testHelpers.spec';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { PromisesManager } from './PromisesManager';

const promisesPackageDir = s`${__dirname}/../../../node_modules/@rokucommunity/promises`;

describe('PromisesManager', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            outDir: outDir
        });
    });
    afterEach(() => {
        program.dispose();
        fsExtra.emptyDirSync(tempDir);
    });

    describe('isPromisesPkgPath', () => {
        it('works for ropm paths', () => {
            expect(PromisesManager.isPromisesPkgPath('source/roku_modules/promises/promises.brs')).to.be.true;
            expect(PromisesManager.isPromisesPkgPath('source/roku_modules/rokucommunity_promises/promises.brs')).to.be.true;
            expect(PromisesManager.isPromisesPkgPath(s`source/roku_modules/promises/promises.brs`)).to.be.true;
        });

        it('does not match other paths', () => {
            expect(PromisesManager.isPromisesPkgPath('source/roku_modules/promises/promises2.brs')).to.be.false;
            expect(PromisesManager.isPromisesPkgPath('source/roku_modules/1promises/promises.brs')).to.be.false;
            //another package's private copy of the library is not available to the project
            expect(PromisesManager.isPromisesPkgPath('source/roku_modules/rooibos_promises/promises.brs')).to.be.false;
            expect(PromisesManager.isPromisesPkgPath(undefined)).to.be.false;
        });
    });

    describe('isPromisesComponentPkgPath', () => {
        it('works for the embedded and ropm paths', () => {
            expect(PromisesManager.isPromisesComponentPkgPath('components/promises/Promise.xml')).to.be.true;
            expect(PromisesManager.isPromisesComponentPkgPath('components/roku_modules/promises/Promise.xml')).to.be.true;
            expect(PromisesManager.isPromisesComponentPkgPath('components/roku_modules/rokucommunity_promises/Promise.xml')).to.be.true;
        });

        it('does not match other paths', () => {
            expect(PromisesManager.isPromisesComponentPkgPath('components/Promise.xml')).to.be.false;
            expect(PromisesManager.isPromisesComponentPkgPath('components/promises/Other.xml')).to.be.false;
            expect(PromisesManager.isPromisesComponentPkgPath('components/roku_modules/rooibos_promises/Promise.xml')).to.be.false;
        });
    });

    describe('applyPrefix', () => {
        it('prefixes function declarations and references to them', () => {
            expect(PromisesManager.applyPrefix(trim`
                function create()
                    return createObject("roSGNode", "Promise")
                end function
                function chain(promise)
                    callback = internal_defaultCallback
                    return onThen(create(), callback)
                end function
                function onThen(promise, callback)
                end function
                function internal_defaultCallback()
                end function
            `, 'promises')).to.eql(trim`
                function promises_create()
                    return createObject("roSGNode", "promises_Promise")
                end function
                function promises_chain(promise)
                    callback = promises_internal_defaultCallback
                    return promises_onThen(promises_create(), callback)
                end function
                function promises_onThen(promise, callback)
                end function
                function promises_internal_defaultCallback()
                end function
            `);
        });

        it('does not prefix anything that is already prefixed', () => {
            const source = trim`
                function promises_create()
                    return createObject("roSGNode", "promises_Promise")
                end function
                function promises_chain()
                    return promises_create()
                end function
            `;
            expect(PromisesManager.applyPrefix(source, 'promises')).to.eql(source);
        });

        it('does not prefix member names, AA keys, or locals that share a function name', () => {
            const source = trim`
                function chain(create)
                    print create
                    result = {
                        chain: function()
                            return m.chain
                        end function
                    }
                    for each chain in [1, 2]
                        print chain
                    end for
                    return result.create()
                end function
                function create()
                end function
            `;
            expect(PromisesManager.applyPrefix(source, 'promises')).to.eql(trim`
                function promises_chain(create)
                    print create
                    result = {
                        chain: function()
                            return m.chain
                        end function
                    }
                    for each chain in [1, 2]
                        print chain
                    end for
                    return result.create()
                end function
                function promises_create()
                end function
            `);
        });

        it('only renames the Promise component in createObject calls', () => {
            expect(PromisesManager.applyPrefix(trim`
                function isPromise(value)
                    print "Promise"
                    return createObject("roSGNode", "Promise")
                end function
            `, 'promises')).to.eql(trim`
                function promises_isPromise(value)
                    print "Promise"
                    return createObject("roSGNode", "promises_Promise")
                end function
            `);
        });

        it('produces a library whose every function reference resolves', () => {
            program.setFile('source/promises.brs', PromisesManager.applyPrefix(
                fsExtra.readFileSync(s`${promisesPackageDir}/dist/source/promises.brs`).toString(),
                'promises'
            ));
            program.setFile('components/promises/Promise.xml', PromisesManager.applyComponentPrefix(
                fsExtra.readFileSync(s`${promisesPackageDir}/dist/components/Promise.xml`).toString(),
                'promises'
            ));
            program.validate();
            //the library itself has a few unreachable sections, which are not relevant here
            expectZeroDiagnostics(program.getDiagnostics().filter(x => x.code !== 'unreachable-code'));
        });
    });

    describe('applyComponentPrefix', () => {
        it('renames the component and drops the source map comment', () => {
            expect(PromisesManager.applyComponentPrefix(trim`
                <component name="Promise" extends="Node">
                </component>
                <!--//# sourceMappingURL=./Promise.xml.map -->
            `, 'rokucommunity_promises')).to.eql(trim`
                <component name="rokucommunity_promises_Promise" extends="Node">
                </component>
            ` + '\n');
        });
    });

    describe('program', () => {
        it('uses the embedded library by default', () => {
            expect(program.promisesPkgPath).to.eql(s`source/promises.brs`);
            expect(program.promisesPrefix).to.eql('promises');
        });

        it('uses promisesDestinationDir for the embedded library', () => {
            program.options.promisesDestinationDir = 'source/opt';
            expect(program.promisesPkgPath).to.eql(s`source/opt/promises.brs`);
        });

        it('reads promisesDestinationDir from compilerOptions', () => {
            const otherProgram = new Program({ rootDir: rootDir, compilerOptions: { promisesDestinationDir: '/source/lib/' } });
            expect(otherProgram.promisesPkgPath).to.eql(s`source/lib/promises.brs`);
            otherProgram.dispose();
        });

        it('is not affected by bslibDestinationDir', () => {
            program.options.bslibDestinationDir = 'source/opt';
            expect(program.promisesPkgPath).to.eql(s`source/promises.brs`);
        });

        it('prefers the aliased ropm copy', () => {
            program.setFile('source/roku_modules/rokucommunity_promises/promises.brs', '');
            program.setFile('source/roku_modules/promises/promises.brs', '');
            expect(program.promisesPkgPath).to.eql(s`source/roku_modules/promises/promises.brs`);
            expect(program.promisesPrefix).to.eql('promises');
        });

        it('uses the non-aliased ropm copy', () => {
            program.setFile('source/roku_modules/rokucommunity_promises/promises.brs', '');
            expect(program.promisesPkgPath).to.eql(s`source/roku_modules/rokucommunity_promises/promises.brs`);
            expect(program.promisesPrefix).to.eql('rokucommunity_promises');
        });
    });

    /**
     * Add a file with an async function, which is what makes the program need the promises library
     */
    function addAsyncFunction() {
        program.setFile('source/async.bs', `
            async function getUser()
            end function
        `);
    }

    describe('hasAsyncFunctions', () => {
        it('is false when no file has an async function', () => {
            program.setFile('source/main.bs', `
                function main()
                    async = 1
                    return async
                end function
            `);
            expect(program.hasAsyncFunctions).to.be.false;
        });

        it('is true for an async function, an async method, or an async anonymous function', () => {
            for (const source of [
                'async function main()\nend function',
                'class Person\n async function load()\n end function\nend class',
                'sub main()\n x = async sub()\n end sub\nend sub'
            ]) {
                program.setFile('source/main.bs', source);
                expect(program.hasAsyncFunctions, source).to.be.true;
            }
        });

        it('ignores async functions that are only declared in a typedef', () => {
            program.setFile('source/lib.brs', 'function getUser()\nend function');
            program.setFile('source/lib.d.bs', 'async function getUser()\nend function');
            expect(program.hasAsyncFunctions).to.be.false;
        });

        it('updates when files change', () => {
            addAsyncFunction();
            expect(program.hasAsyncFunctions).to.be.true;
            program.setFile('source/async.bs', 'function getUser()\nend function');
            expect(program.hasAsyncFunctions).to.be.false;
            addAsyncFunction();
            program.removeFile('source/async.bs');
            expect(program.hasAsyncFunctions).to.be.false;
        });
    });

    describe('build without async functions', () => {
        it('does not add the library, its component, or the import', async () => {
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.false;
            expect(fsExtra.pathExistsSync(s`${outDir}/components/promises/Promise.xml`)).to.be.false;
            const component = fsExtra.readFileSync(s`${outDir}/components/Comp.xml`).toString();
            expect(component).not.to.include('promises.brs');
            //bslib is still always imported
            expect(component).to.include('<script type="text/brightscript" uri="pkg:/source/bslib.brs" />');
        });

        it('does not import a ropm copy of the library either', async () => {
            program.setFile('source/roku_modules/promises/promises.brs', 'function promises_chain()\nend function');
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `);
            await program.build({ outDir: outDir });
            expect(fsExtra.readFileSync(s`${outDir}/components/Comp.xml`).toString()).not.to.include('promises.brs');
        });

        it('adds the library once an async function is added, and drops it once the last one is removed', async () => {
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.false;

            addAsyncFunction();
            fsExtra.emptyDirSync(outDir);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.true;

            program.removeFile('source/async.bs');
            fsExtra.emptyDirSync(outDir);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.false;
        });
    });

    describe('build', () => {
        beforeEach(() => {
            addAsyncFunction();
        });

        it('copies the embedded library and its component, with prefixes', async () => {
            await program.build({ outDir: outDir });

            const library = fsExtra.readFileSync(s`${outDir}/source/promises.brs`).toString();
            expect(library).to.include('function promises_chain(');
            expect(library).to.include('createObject("roSGNode", "promises_Promise")');
            expect(library).not.to.match(/^function chain\(/m);

            expect(
                fsExtra.readFileSync(s`${outDir}/components/promises/Promise.xml`).toString()
            ).to.include('<component name="promises_Promise" extends="Node">');
        });

        it('copies the embedded library to promisesDestinationDir, and imports it from there', async () => {
            program.options.promisesDestinationDir = 'source/opt';
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/opt/promises.brs`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.false;
            //bslib stays where it was
            expect(fsExtra.pathExistsSync(s`${outDir}/source/bslib.brs`)).to.be.true;
            const component = fsExtra.readFileSync(s`${outDir}/components/Comp.xml`).toString();
            expect(component).to.include('<script type="text/brightscript" uri="pkg:/source/opt/promises.brs" />');
            expect(component).to.include('<script type="text/brightscript" uri="pkg:/source/bslib.brs" />');
        });

        it('keeps the embedded library in source when only bslibDestinationDir is set', async () => {
            program.options.bslibDestinationDir = 'source/opt';
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/opt/bslib.brs`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${outDir}/source/opt/promises.brs`)).to.be.false;
        });

        it('copies the embedded library on every build', async () => {
            await program.build({ outDir: outDir });
            fsExtra.emptyDirSync(outDir);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${outDir}/components/promises/Promise.xml`)).to.be.true;
        });

        it('does not copy the embedded library when found in roku_modules', async () => {
            program.setFile('source/roku_modules/promises/promises.brs', 'function promises_chain()\nend function');
            program.setFile('components/roku_modules/promises/Promise.xml', trim`
                <component name="promises_Promise" extends="Node">
                </component>
            `);
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `);
            await program.build({ outDir: outDir });
            expect(fsExtra.pathExistsSync(s`${outDir}/source/promises.brs`)).to.be.false;
            expect(fsExtra.pathExistsSync(s`${outDir}/components/promises/Promise.xml`)).to.be.false;
            expect(fsExtra.pathExistsSync(s`${outDir}/source/roku_modules/promises/promises.brs`)).to.be.true;
            expect(
                fsExtra.readFileSync(s`${outDir}/components/Comp.xml`).toString()
            ).to.include('<script type="text/brightscript" uri="pkg:/source/roku_modules/promises/promises.brs" />');
        });

        it('does not copy the embedded library when the project has its own at the same path', async () => {
            program.setFile('source/promises.brs', 'function promises_chain()\nend function');
            await program.build({ outDir: outDir });
            expect(
                fsExtra.readFileSync(s`${outDir}/source/promises.brs`).toString()
            ).to.eql('function promises_chain()\nend function');
            expect(fsExtra.pathExistsSync(s`${outDir}/components/promises/Promise.xml`)).to.be.false;
        });

        it('does not import the library into its own Promise component', async () => {
            program.setFile('source/roku_modules/promises/promises.brs', 'function promises_chain()\nend function');
            program.setFile('components/roku_modules/promises/Promise.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="promises_Promise" extends="Node">
                </component>
            `);
            await program.build({ outDir: outDir });
            const component = fsExtra.readFileSync(s`${outDir}/components/roku_modules/promises/Promise.xml`).toString();
            expect(component).not.to.include('promises.brs');
            expect(component).to.include('bslib.brs');
        });
    });

    describe('validation', () => {
        it('does not flag an explicit script import of the embedded library', () => {
            addAsyncFunction();
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/promises.brs" />
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags an explicit script import of the embedded library when nothing uses async, since it will not exist', () => {
            program.setFile('components/Comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/promises.brs" />
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.referencedFileDoesNotExist()
            ]);
        });
    });
});
