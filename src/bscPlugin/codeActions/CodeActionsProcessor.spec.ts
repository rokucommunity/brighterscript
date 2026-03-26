import { expect } from '../../chai-config.spec';
import { URI } from 'vscode-uri';
import type { Range } from 'vscode-languageserver';
import type { BscFile } from '../../interfaces';
import { Program } from '../../Program';
import { expectCodeActions, trim } from '../../testHelpers.spec';
import { standardizePath as s, util } from '../../util';
import { rootDir } from '../../testHelpers.spec';

describe('CodeActionsProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir,
            autoImportComponentScript: true
        });
    });
    afterEach(() => {
        program.dispose();
    });

    /**
     * Helper function for testing code actions
     */
    function testGetCodeActions(file: BscFile | string, range: Range, expected: string[]) {
        program.validate();
        expect(
            program.getCodeActions(
                typeof file === 'string' ? file : file.srcPath,
                range
            ).map(x => x.title).sort()
        ).to.eql(expected);
    }

    describe('getCodeActions', () => {
        it('suggests `extends=Group`', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            program.validate();
            expectCodeActions(() => {
                program.getCodeActions(
                    file.srcPath,
                    //<comp|onent name="comp1">
                    util.createRange(1, 5, 1, 5)
                );
            }, [{
                title: `Extend "Group"`,
                isPreferred: true,
                kind: 'quickfix',
                changes: [{
                    filePath: s`${rootDir}/components/comp1.xml`,
                    newText: ' extends="Group"',
                    type: 'insert',
                    //<component name="comp1"|>
                    position: util.createPosition(1, 23)
                }]
            }, {
                title: `Extend "Task"`,
                kind: 'quickfix',
                changes: [{
                    filePath: s`${rootDir}/components/comp1.xml`,
                    newText: ' extends="Task"',
                    type: 'insert',
                    //<component name="comp1"|>
                    position: util.createPosition(1, 23)
                }]
            }, {
                title: `Extend "ContentNode"`,
                kind: 'quickfix',
                changes: [{
                    filePath: s`${rootDir}/components/comp1.xml`,
                    newText: ' extends="ContentNode"',
                    type: 'insert',
                    //<component name="comp1"|>
                    position: util.createPosition(1, 23)
                }]
            }]);
        });

        it('adds attribute at end of component with multiple attributes`', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" attr2="attr3" attr3="attr3">
                </component>
            `);
            program.validate();
            const codeActions = program.getCodeActions(
                file.srcPath,
                //<comp|onent name="comp1">
                util.createRange(1, 5, 1, 5)
            );
            expect(
                codeActions[0].edit!.changes![URI.file(s`${rootDir}/components/comp1.xml`).toString()][0].range
            ).to.eql(
                util.createRange(1, 51, 1, 51)
            );
        });

        it('does not produce duplicate code actions for bs imports', () => {
            //define the function in two files
            program.setFile('components/lib1.brs', `
                sub doSomething()
                end sub
            `);
            program.setFile('components/lib2.brs', `
                sub doSomething()
                end sub
            `);

            //use the function in this file
            const componentCommonFile = program.setFile('components/ComponentCommon.bs', `
                sub init()
                    doSomething()
                end sub
            `);

            //import the file in two scopes
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="ComponentCommon.bs" />
                </component>
            `);
            program.setFile('components/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="ComponentCommon.bs" />
                </component>
            `);

            program.validate();

            //we should only get each file import suggestion exactly once
            const codeActions = program.getCodeActions(
                componentCommonFile.srcPath,
                // doSome|thing()
                util.createRange(2, 22, 2, 22)
            );
            expect(codeActions.map(x => x.title).sort()).to.eql([
                `import "pkg:/components/lib1.brs"`,
                `import "pkg:/components/lib2.brs"`
            ]);
        });

        it('does not suggest imports for brs files', () => {
            //import the file in two scopes
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.brs" />
                </component>
            `);
            //import the function here
            const file = program.setFile('components/comp1.brs', `
                sub init()
                    DoSomething()
                end sub
            `);

            //define the function here
            program.setFile('source/lib.brs', `
                sub DoSomething()
                end sub
            `);

            program.validate();

            //there should be no code actions since this is a brs file
            const codeActions = program.getCodeActions(
                file.srcPath,
                // DoSometh|ing()
                util.createRange(2, 28, 2, 28)
            );
            expect(codeActions).to.be.empty;
        });

        it('suggests class imports', () => {
            //import the file in two scopes
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.bs" />
                </component>
            `);
            const file = program.setFile('components/comp1.bs', `
                sub init()
                    dude = new Person()
                end sub
            `);

            program.setFile('source/Person.bs', `
                class Person
                end class
            `);

            program.validate();

            expect(
                program.getCodeActions(
                    file.srcPath,
                    // new Per|son()
                    util.createRange(2, 34, 2, 34)
                ).map(x => x.title).sort()
            ).to.eql([
                `import "pkg:/source/Person.bs"`
            ]);
        });

        it('suggests class imports', () => {
            //import the file in two scopes
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.bs" />
                </component>
            `);
            //import the function here
            const file = program.setFile('components/comp1.bs', `
                sub init()
                    kitty = new Animals.Cat()
                end sub
            `);
            program.setFile('source/Animals.bs', `
                namespace Animals
                    class Cat
                    end class
                end namespace
            `);

            program.validate();

            expect(
                program.getCodeActions(
                    file.srcPath,
                    // new Anim|als.Cat()
                    util.createRange(2, 36, 2, 36)
                ).map(x => x.title).sort()
            ).to.eql([
                `import "pkg:/source/Animals.bs"`
            ]);
        });

        it('suggests all files for a root namespace name', () => {
            program.setFile('source/first.bs', `
                namespace alpha
                    function firstAction()
                    end function
                end namespace
            `);
            program.setFile('source/second.bs', `
                namespace alpha.beta
                    function secondAction()
                    end function
                end namespace
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    print alpha.secondAction()
                end sub
            `);

            // print al|pha.secondAction()
            testGetCodeActions(file, util.createRange(2, 28, 2, 28), [
                `import "pkg:/source/first.bs"`,
                `import "pkg:/source/second.bs"`
            ]);
        });

        it('suggests files for second part of missing namespace', () => {
            program.setFile('source/first.bs', `
                namespace alpha
                    function firstAction()
                    end function
                end namespace
            `);
            program.setFile('source/second.bs', `
                namespace alpha.beta
                    function secondAction()
                    end function
                end namespace
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                import "pkg:/source/first.bs"
                sub init()
                    print alpha.beta.secondAction()
                end sub
            `);

            // print alpha.be|ta.secondAction()
            testGetCodeActions(file, util.createRange(3, 34, 3, 34), [`import "pkg:/source/second.bs"`]);
        });
    });

    describe('Fix all: Auto fixable missing imports', () => {
        it('offers fix-all when multiple unambiguous imports are missing', () => {
            program.setFile('source/lib1.bs', `
                function doSomething()
                end function
            `);
            program.setFile('source/lib2.bs', `
                function doSomethingElse()
                end function
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    doSomething()
                    doSomethingElse()
                end sub
            `);

            // doSome|thing()
            testGetCodeActions(file, util.createRange(2, 26, 2, 26), [
                `Fix all: Auto fixable missing imports`,
                `import "pkg:/source/lib1.bs"`
            ]);
        });

        it('does not offer fix-all when only one import is missing', () => {
            program.setFile('source/lib1.bs', `
                function doSomething()
                end function
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    doSomething()
                end sub
            `);

            // doSome|thing()
            testGetCodeActions(file, util.createRange(2, 26, 2, 26), [
                `import "pkg:/source/lib1.bs"`
            ]);
        });

        it('excludes ambiguous names from fix-all', () => {
            program.setFile('source/lib1.bs', `
                function doSomething()
                end function
            `);
            program.setFile('source/lib2.bs', `
                function doSomething()
                end function
            `);
            program.setFile('source/lib3.bs', `
                function doSomethingUnambiguous()
                end function
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    doSomething()
                    doSomethingUnambiguous()
                end sub
            `);

            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 26, 2, 26));
            // fix-all only has the unambiguous import, not doSomething (which has 2 options)
            const fixAll = actions.find(a => a.title === 'Fix all: Auto fixable missing imports');
            expect(fixAll).to.be.undefined;
        });

        it('includes class imports in fix-all', () => {
            program.setFile('source/lib1.bs', `
                function doSomething()
                end function
            `);
            program.setFile('source/MyClass.bs', `
                class MyClass
                end class
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    doSomething()
                    obj = new MyClass()
                end sub
            `);

            // doSome|thing()
            testGetCodeActions(file, util.createRange(2, 26, 2, 26), [
                `Fix all: Auto fixable missing imports`,
                `import "pkg:/source/lib1.bs"`
            ]);
        });

        it('deduplicates when multiple missing names resolve to the same file', () => {
            program.setFile('source/lib1.bs', `
                function doSomething()
                end function
                function doSomethingElse()
                end function
            `);
            program.setFile('source/lib2.bs', `
                function doThird()
                end function
            `);
            program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
            const file = program.setFile('components/MainScene.bs', `
                sub init()
                    doSomething()
                    doSomethingElse()
                    doThird()
                end sub
            `);

            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 26, 2, 26));
            const fixAll = actions.find(a => a.title === 'Fix all: Auto fixable missing imports');
            // lib1.bs and lib2.bs — only 2 changes despite 3 missing names
            expect(Object.values(fixAll!.edit!.changes!)[0]).to.have.lengthOf(2);
        });
    });

    it('suggests imports at very start and very end of diagnostic', () => {
        program.setFile('source/first.bs', `
            namespace alpha
                function firstAction()
                end function
            end namespace
        `);
        program.setFile('components/MainScene.xml', trim`<component name="MainScene"></component>`);
        const file = program.setFile('components/MainScene.bs', `
            sub init()
                print alpha.firstAction()
            end sub
        `);

        // print |alpha.firstAction()
        testGetCodeActions(file, util.createRange(2, 22, 2, 22), [`import "pkg:/source/first.bs"`]);
        // print alpha|.firstAction()
        testGetCodeActions(file, util.createRange(2, 27, 2, 27), [`import "pkg:/source/first.bs"`]);
    });

    describe('void function return value', () => {
        it('suggests deleting the return value and converting the sub to a function', () => {
            const file = program.setFile('source/main.brs', `
                sub test()
                    'should not have a return value here...
                    return true
                end sub
            `);

            // return tr|ue
            testGetCodeActions(file, util.createRange(3, 29, 3, 29), [`Convert sub to function`, `Remove return value`]);
        });

        it('suggests deleting the return type from void function', () => {
            const file = program.setFile('source/main.brs', `
                function test() as void
                    'should not have a return value here...
                    return true
                end function
            `);

            // return tr|ue
            testGetCodeActions(file, util.createRange(3, 29, 3, 29), [`Remove return type from function declaration`, `Remove return value`]);
        });

        it('offers fix-all when multiple void-return violations exist in the file', () => {
            const file = program.setFile('source/main.brs', `
                sub test1()
                    return true
                end sub
                sub test2()
                    return false
                end sub
            `);

            // return tr|ue (first violation)
            testGetCodeActions(file, util.createRange(2, 27, 2, 27), [
                `Convert sub to function`,
                `Fix all: Remove void return values`,
                `Remove return value`
            ]);
        });

        it('does not offer fix-all when only one void-return violation exists', () => {
            const file = program.setFile('source/main.brs', `
                sub test1()
                    return true
                end sub
                sub test2()
                end sub
            `);

            // return tr|ue
            testGetCodeActions(file, util.createRange(2, 27, 2, 27), [`Convert sub to function`, `Remove return value`]);
        });

        it('does not duplicate fix-all when multiple violations are at the cursor range', () => {
            const file = program.setFile('source/main.brs', `
                sub test1()
                    return true
                end sub
                sub test2()
                    return false
                end sub
            `);

            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 20, 4, 20));
            expect(actions.filter(a => a.title === 'Fix all: Remove void return values')).to.have.lengthOf(1);
        });
    });

    describe('typed function/sub empty return', () => {
        it('suggests deleting the return value and converting the sub to a function', () => {
            const file = program.setFile('source/main.brs', `
                function test()
                    'need a return value here...
                    return
                end function
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(3, 23, 3, 23), [`Add void return type to function declaration`, `Convert function to sub`]);
        });

        it('suggests deleting the return type from void function', () => {
            const file = program.setFile('source/main.brs', `
                sub test() as integer
                    'need a return value here...
                    return
                end sub
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(3, 23, 3, 23), [`Remove return type from sub declaration`]);
        });

        it('offers fix-all for multiple subs with return types', () => {
            const file = program.setFile('source/main.brs', `
                sub test1() as integer
                    return
                end sub
                sub test2() as string
                    return
                end sub
            `);

            // ret|urn (first violation)
            testGetCodeActions(file, util.createRange(2, 24, 2, 24), [
                `Fix all: Remove return type from sub declarations`,
                `Remove return type from sub declaration`
            ]);
        });

        it('offers fix-all for multiple functions with missing return types', () => {
            const file = program.setFile('source/main.brs', `
                function test1()
                    return
                end function
                function test2()
                    return
                end function
            `);

            // ret|urn (first violation)
            testGetCodeActions(file, util.createRange(2, 24, 2, 24), [
                `Add void return type to function declaration`,
                `Convert function to sub`,
                `Fix all: Add void return type to function declarations`
            ]);
        });

        it('does not offer fix-all when only one non-void-return violation exists', () => {
            const file = program.setFile('source/main.brs', `
                sub test1() as integer
                    return
                end sub
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(2, 24, 2, 24), [`Remove return type from sub declaration`]);
        });

        it('deduplicates fix-all changes when one function has multiple bare returns', () => {
            const file = program.setFile('source/main.brs', `
                sub test1() as integer
                    return
                    return
                end sub
                sub test2() as string
                    return
                end sub
            `);

            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 24, 2, 24));
            const fixAll = actions.find(a => a.title === 'Fix all: Remove return type from sub declarations');
            // Two unique functions → two changes (not three)
            expect(Object.values(fixAll!.edit!.changes!)[0]).to.have.lengthOf(2);
        });
    });

    describe('referencedFileDoesNotExist', () => {
        it('offers to remove the script import line', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/missing.brs" />
                </component>
            `);
            // uri="pkg:/source/missing.brs" is on line 2
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), ['Remove script import']);
        });

        it('deletes the entire script tag line', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/missing.brs" />
                </component>
            `);
            program.validate();
            expectCodeActions(() => {
                program.getCodeActions(file.srcPath, util.createRange(2, 50, 2, 50));
            }, [{
                title: 'Remove script import',
                kind: 'quickfix',
                changes: [{
                    type: 'delete',
                    filePath: s`${rootDir}/components/comp1.xml`,
                    range: util.createRange(2, 0, 3, 0)
                }]
            }]);
        });

        it('offers fix-all when multiple missing imports exist', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/missing1.brs" />
                    <script type="text/brightscript" uri="pkg:/source/missing2.brs" />
                </component>
            `);
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), [
                'Fix all: Remove script imports',
                'Remove script import'
            ]);
        });
    });

    describe('unnecessaryScriptImportInChildFromParent', () => {
        it('offers to remove the redundant script import', () => {
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            program.setFile('source/lib.brs', '');
            const file = program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            // uri on line 2 of child.xml
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), ['Remove redundant script import']);
        });

        it('offers fix-all when multiple redundant imports exist', () => {
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib1.brs" />
                    <script type="text/brightscript" uri="pkg:/source/lib2.brs" />
                </component>
            `);
            program.setFile('source/lib1.brs', '');
            program.setFile('source/lib2.brs', '');
            const file = program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/source/lib1.brs" />
                    <script type="text/brightscript" uri="pkg:/source/lib2.brs" />
                </component>
            `);
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), [
                'Fix all: Remove redundant script imports',
                'Remove redundant script import'
            ]);
        });
    });

    describe('unnecessaryCodebehindScriptImport', () => {
        it('offers to remove the unnecessary codebehind import', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/comp1.brs" />
                </component>
            `);
            program.setFile('components/comp1.brs', '');
            // uri on line 2
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), ['Remove unnecessary codebehind import']);
        });
    });

    describe('scriptImportCaseMismatch', () => {
        it('offers to fix the casing of the script import path', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/SOURCE/lib.brs" />
                </component>
            `);
            program.setFile('source/lib.brs', '');
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), ['Fix script import path casing']);
        });

        it('replaces the URI value with the correctly-cased path', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/SOURCE/lib.brs" />
                </component>
            `);
            program.setFile('source/lib.brs', '');
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 50, 2, 50));
            const fix = actions.find(a => a.title === 'Fix script import path casing');
            const changes = Object.values(fix!.edit!.changes!)[0];
            expect(changes[0].newText).to.equal('pkg:/source/lib.brs');
        });

        it('offers fix-all when multiple case-mismatched imports exist', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/SOURCE/lib1.brs" />
                    <script type="text/brightscript" uri="pkg:/SOURCE/lib2.brs" />
                </component>
            `);
            program.setFile('source/lib1.brs', '');
            program.setFile('source/lib2.brs', '');
            testGetCodeActions(file, util.createRange(2, 50, 2, 50), [
                'Fix all: Fix script import path casing',
                'Fix script import path casing'
            ]);
        });

        it('offers to fix the casing of a relative script import path', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="LIB.brs" />
                </component>
            `);
            program.setFile('components/lib.brs', '');
            testGetCodeActions(file, util.createRange(2, 45, 2, 45), ['Fix script import path casing']);
        });

        it('replaces a relative URI with the correctly-cased relative path', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="LIB.brs" />
                </component>
            `);
            program.setFile('components/lib.brs', '');
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 45, 2, 45));
            const fix = actions.find(a => a.title === 'Fix script import path casing');
            const changes = Object.values(fix!.edit!.changes!)[0];
            expect(changes[0].newText).to.equal('lib.brs');
        });

        it('replaces a cross-directory relative URI with the correctly-cased relative path', () => {
            const file = program.setFile('components/sub/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script type="text/brightscript" uri="../utils/HELPER.brs" />
                </component>
            `);
            program.setFile('components/utils/helper.brs', '');
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 50, 2, 50));
            const fix = actions.find(a => a.title === 'Fix script import path casing');
            const changes = Object.values(fix!.edit!.changes!)[0];
            expect(changes[0].newText).to.equal('../utils/helper.brs');
        });
    });

    describe('missingOverrideKeyword', () => {
        it('offers to add the override keyword', () => {
            program.setFile('components/comp1.xml', trim`<component name="comp1" extends="Scene"></component>`);
            const file = program.setFile('components/comp1.bs', `
                class Animal
                    function speak()
                    end function
                end class
                class Dog extends Animal
                    function speak()
                    end function
                end class
            `);
            // "function speak()" in Dog — diagnostic starts at the function keyword on line 6
            testGetCodeActions(file, util.createRange(6, 20, 6, 20), [`Add missing 'override' keyword`]);
        });

        it('inserts override before the function keyword', () => {
            program.setFile('components/comp1.xml', trim`<component name="comp1" extends="Scene"></component>`);
            const file = program.setFile('components/comp1.bs', `
                class Animal
                    function speak()
                    end function
                end class
                class Dog extends Animal
                    function speak()
                    end function
                end class
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(6, 20, 6, 20));
            const fix = actions.find(a => a.title === `Add missing 'override' keyword`);
            const changes = Object.values(fix!.edit!.changes!)[0];
            expect(changes[0].newText).to.equal('override ');
        });

        it('offers fix-all when multiple methods are missing override', () => {
            program.setFile('components/comp1.xml', trim`<component name="comp1" extends="Scene"></component>`);
            const file = program.setFile('components/comp1.bs', `
                class Animal
                    function speak()
                    end function
                    function move()
                    end function
                end class
                class Dog extends Animal
                    function speak()
                    end function
                    function move()
                    end function
                end class
            `);
            testGetCodeActions(file, util.createRange(8, 20, 8, 20), [
                `Add missing 'override' keyword`,
                `Fix all: Add missing 'override' keywords`
            ]);
        });
    });

    describe('cannotUseOverrideKeywordOnConstructorFunction', () => {
        it('offers to remove override from constructor', () => {
            const file = program.setFile('source/main.bs', `
                class Dog
                    override function new()
                    end function
                end class
            `);
            // "override" is on line 2
            testGetCodeActions(file, util.createRange(2, 20, 2, 20), [`Remove 'override' from constructor`]);
        });

        it('deletes the override keyword and trailing space', () => {
            const file = program.setFile('source/main.bs', `
                class Dog
                    override function new()
                    end function
                end class
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 20, 2, 20));
            const fix = actions.find(a => a.title === `Remove 'override' from constructor`);
            const changes = Object.values(fix!.edit!.changes!)[0];
            // range covers "override " (8 chars + 1 space)
            expect(changes[0].range.start.character).to.equal(changes[0].range.end.character - 9);
        });
    });
});
