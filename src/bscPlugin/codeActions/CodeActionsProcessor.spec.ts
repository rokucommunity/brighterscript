import { expect } from '../../chai-config.spec';
import type { CodeAction, Range } from 'vscode-languageserver';
import { Program } from '../../Program';
import { expectCodeActions, trim } from '../../testHelpers.spec';
import { standardizePath as s, util } from '../../util';
import type { BscFile } from '../../files/BscFile';
import type { BsDiagnostic, ProvideCodeActionsEvent } from '../../interfaces';
import { rootDir } from '../../testHelpers.spec';
import { CodeActionsProcessor } from './CodeActionsProcessor';

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
     * Helper function for testing code actions. By default it filters out the generic
     * `Disable {code} for this line/file` quick fixes because every diagnostic gets them
     * and the per-feature tests below only care about feature-specific actions.
     */
    function testGetCodeActions(file: BscFile | string, range: Range, expected: string[], options?: { includeDisableDirectives?: boolean }) {
        program.validate();
        const titles = program.getCodeActions(
            typeof file === 'string' ? file : file.srcPath,
            range
        ).map(x => x.title);
        expect(filterDisableActions(titles, options).sort()).to.eql(expected);
    }

    /**
     * Drops the generic `Disable {code} for this line/file` titles from a list so feature-level
     * assertions can stay focused on their own actions.
     */
    function filterDisableActions(titles: string[], options?: { includeDisableDirectives?: boolean }) {
        if (options?.includeDisableDirectives) {
            return titles;
        }
        return titles.filter(t => !/^Disable .+ for this (line|file)/.test(t));
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
                codeActions[0].edit!.changes![util.pathToUri(s`${rootDir}/components/comp1.xml`)][0].range
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

            //we should only get each file import suggestion exactly once
            // doSome|thing()
            testGetCodeActions(componentCommonFile, util.createRange(2, 22, 2, 22), [
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

            //there should be no code actions since this is a brs file (other than the
            //bs:disable suggestions, which fire on every diagnostic with a `code`)
            const codeActions = program.getCodeActions(
                file.srcPath,
                // DoSometh|ing()
                util.createRange(2, 28, 2, 28)
            ).filter(action => !action.title?.startsWith('Disable '));
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

            // new Per|son()
            testGetCodeActions(file, util.createRange(2, 34, 2, 34), [
                `import "pkg:/source/Person.bs"`
            ]);
        });

        it('suggests class imports', () => {
            //import the file in two scopes
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Group">
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

            // new Anim|als.Cat()
            testGetCodeActions(file, util.createRange(2, 36, 2, 36), [
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
            program.setFile('components/MainScene.xml', trim`<component name="MainScene" extends="Scene"></component>`);
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

        it('clears suggestedImports after process() so the same instance could be reused in the future', () => {
            program.setFile('source/lib.bs', `
                function doSomething()
                end function
            `);
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Scene">
                    <script uri="comp1.bs" />
                </component>
            `);
            const file = program.setFile('components/comp1.bs', `
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();

            const range = util.createRange(2, 24, 2, 24);
            const fileUri = util.pathToUri(file.srcPath);
            const event: ProvideCodeActionsEvent = {
                program: program,
                file: file,
                range: range,
                scopes: program.getScopesForFile(file),
                diagnostics: program.getDiagnostics().filter(d => d.location?.uri === fileUri && util.rangesIntersectOrTouch(d.location.range, range)),
                codeActions: []
            };

            const processor = new CodeActionsProcessor(event);
            processor.process();
            const firstCallTitles = event.codeActions.map(x => x.title).sort();

            // Reset codeActions and call process() again on the same instance.
            // If suggestedImports were NOT cleared, the second call would return no import suggestions.
            event.codeActions = [];
            processor.process();
            const secondCallTitles = event.codeActions.map(x => x.title).sort();

            expect(secondCallTitles).to.eql(firstCallTitles);
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
            program.setFile('components/MainScene.xml', trim`<component name="MainScene" extends="Scene"></component>`);
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
        program.setFile('components/MainScene.xml', trim`<component name="MainScene" extends="Scene"></component>`);
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

        it('suggests converting sub to function with inline body', () => {
            const file = program.setFile('source/main.brs', `
                sub test() : print "onItemContentChange"
                    return true
                end sub
            `);

            // return tr|ue
            testGetCodeActions(file, util.createRange(2, 28, 2, 28), [`Convert sub to function`, `Remove return value`]);

            // verify only the `sub` and `end sub` keywords are replaced, not the `: print ...` inline body
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 28, 2, 28));
            const convertAction = actions.find(a => a.title === 'Convert sub to function');
            const changes = Object.values(convertAction!.edit!.changes!)[0];
            // change[0] replaces `sub` keyword only
            expect(changes[0].range).to.eql(util.createRange(1, 16, 1, 19));
            expect(changes[0].newText).to.eql('function');
            // change[1] replaces `end sub` keyword only
            expect(changes[1].range).to.eql(util.createRange(3, 16, 3, 23));
            expect(changes[1].newText).to.eql('end function');
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

        it('suggests deleting only the return type from void function with inline body', () => {
            const file = program.setFile('source/main.brs', `
                function test() as void : print "onItemContentChange"
                    return "test"
                end function
            `);

            // return |"test"
            testGetCodeActions(file, util.createRange(2, 28, 2, 28), [`Remove return type from function declaration`, `Remove return value`]);

            // verify only ` as void` is deleted, not the `: print ...` inline body
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 28, 2, 28));
            const removeTypeAction = actions.find(a => a.title === 'Remove return type from function declaration');
            const changes = Object.values(removeTypeAction!.edit!.changes!)[0];
            // range should span ` as void` only, starting after `)` and ending at the close of `void`
            expect(changes[0].range).to.eql(util.createRange(1, 31, 1, 39));
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
        it('suggests adding `as void` to function declaration or converting to sub', () => {
            const file = program.setFile('source/main.brs', `
                function test()
                    'need a return value here...
                    return
                end function
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(3, 23, 3, 23), [`Add void return type to function declaration`, `Convert function to sub`]);
        });

        it('suggests adding void return type to function with inline body', () => {
            const file = program.setFile('source/main.brs', `
                function test() : print "onItemContentChange"
                    return
                end function
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(2, 23, 2, 23), [`Add void return type to function declaration`, `Convert function to sub`]);

            // verify ` as void` is inserted after `)`, not after the inline body
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 23, 2, 23));
            const addVoidAction = actions.find(a => a.title === 'Add void return type to function declaration');
            const changes = Object.values(addVoidAction!.edit!.changes!)[0];
            // insert position should be immediately after `)`, before ` : print ...`
            expect(changes[0].range).to.eql(util.createRange(1, 31, 1, 31));
            expect(changes[0].newText).to.eql(' as void');
        });

        it('suggests removing the return type from sub with return type', () => {
            const file = program.setFile('source/main.brs', `
                sub test() as integer
                    'need a return value here...
                    return
                end sub
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(3, 23, 3, 23), [`Remove return type from sub declaration`]);
        });

        it('suggests deleting only the return type from sub with inline body', () => {
            const file = program.setFile('source/main.brs', `
                sub test() as integer : print "onItemContentChange"
                    return
                end sub
            `);

            // ret|urn
            testGetCodeActions(file, util.createRange(2, 23, 2, 23), [`Remove return type from sub declaration`]);

            // verify only ` as integer` is deleted, not the `: print ...` inline body
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 23, 2, 23));
            const removeTypeAction = actions.find(a => a.title === 'Remove return type from sub declaration');
            const changes = Object.values(removeTypeAction!.edit!.changes!)[0];
            // range should span ` as integer` only, starting after `)` and ending at the close of `integer`
            expect(changes[0].range).to.eql(util.createRange(1, 26, 1, 37));
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

    describe('mismatched loop terminator', () => {
        it('offers a single quick fix for `while ... next`', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    while n <= 3
                        n = n + 1
                    next
                end sub
            `);
            // cursor on the bogus `next` (line 4)
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), [`Convert 'next' to 'end while'`]);
        });

        it('replaces only the bogus `next` token, preserving indentation', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    while n <= 3
                        n = n + 1
                    next
                end sub
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(4, 20, 4, 20));
            const fix = actions.find(a => a.title === `Convert 'next' to 'end while'`);
            const changes = Object.values(fix!.edit!.changes!)[0];
            expect(changes).to.be.lengthOf(1);
            expect(changes[0].newText).to.equal('end while');
            //the replace range is exactly the 4-character `next` token
            expect(changes[0].range.end.character - changes[0].range.start.character).to.equal(4);
        });

        it('marks the `end while` quick fix as preferred for `while ... next`', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    while n <= 3
                        n = n + 1
                    next
                end sub
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(4, 20, 4, 20));
            const fix = actions.find(a => a.title === `Convert 'next' to 'end while'`);
            expect(fix!.isPreferred).to.equal(true);
        });

        it('offers a fix-all for multiple `while ... next` instances in the same file', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    while x
                        x = false
                    next
                    while y
                        y = false
                    next
                end sub
            `);
            //cursor on the first bogus `next`
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), [
                `Convert 'next' to 'end while'`,
                `Fix all: Convert 'next' to 'end while'`
            ]);
        });

        it('offers two quick fixes (end for preferred, next) for `for ... end while`', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    for i = 0 to 3
                        print i
                    end while
                end sub
            `);
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), [
                `Convert 'end while' to 'end for'`,
                `Convert 'end while' to 'next'`
            ]);
        });

        it('marks the `end for` quick fix as preferred and `next` as non-preferred', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    for i = 0 to 3
                        print i
                    end while
                end sub
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(4, 20, 4, 20));
            const endForFix = actions.find(a => a.title === `Convert 'end while' to 'end for'`);
            const nextFix = actions.find(a => a.title === `Convert 'end while' to 'next'`);
            expect(endForFix!.isPreferred).to.equal(true);
            expect(nextFix!.isPreferred).to.not.equal(true);
        });

        it('offers two quick fixes for `for each ... end while`', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    for each x in arr
                        print x
                    end while
                end sub
            `);
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), [
                `Convert 'end while' to 'end for'`,
                `Convert 'end while' to 'next'`
            ]);
        });

        it('offers fix-all variants for both end for and next when there are multiple `for ... end while` instances', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    for i = 0 to 3
                        print i
                    end while
                    for j = 0 to 3
                        print j
                    end while
                end sub
            `);
            //cursor on the first bogus `end while`
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), [
                `Convert 'end while' to 'end for'`,
                `Convert 'end while' to 'next'`,
                `Fix all: Convert 'end while' to 'end for'`,
                `Fix all: Convert 'end while' to 'next'`
            ]);
        });

        it('does not offer the quick fix for a valid `for ... next`', () => {
            const file = program.setFile('source/main.bs', `
                sub a()
                    for i = 0 to 3
                        print i
                    next
                end sub
            `);
            //cursor on the valid `next`
            testGetCodeActions(file, util.createRange(4, 20, 4, 20), []);
        });
    });

    describe('disable diagnostic actions', () => {
        const findLineAction = (actions: CodeAction[], code: string | number) => actions.find(a => a.title.startsWith(`Disable ${code} for this line`));
        const findFileAction = (actions: CodeAction[], code: string | number) => actions.find(a => a.title.startsWith(`Disable ${code} for this file`));

        it('emits "Disable for this line" and "Disable for this file" actions for any diagnostic with a code', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22));
            //the diagnostic for an undefined function — code is `cannotFindFunction` (cannot-find-function)
            expect(findLineAction(actions, 'cannot-find-function'), 'expected a "Disable cannot-find-function for this line: ..." action').to.exist;
            expect(findFileAction(actions, 'cannot-find-function'), 'expected a "Disable cannot-find-function for this file: ..." action').to.exist;
        });

        it('includes the diagnostic message in the action title', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();
            const actions = program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22));
            const action = findLineAction(actions, 'cannot-find-function');
            expect(action!.title).to.match(/^Disable cannot-find-function for this line: .+/);
            //the message portion is the diagnostic's message, so it should mention the missing function name
            expect(action!.title).to.include('doSomething');
        });

        it('inserts a bs:disable-next-line directive above the diagnostic, preserving indent', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();
            const action = findLineAction(program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22)), 'cannot-find-function');
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            expect(edits).to.have.lengthOf(1);
            //"                    doSomething()" — 20 spaces of indent on line 2
            expect(edits[0].newText).to.equal(`                    ' bs:disable-next-line: cannot-find-function\n`);
            expect(edits[0].range).to.eql(util.createRange(2, 0, 2, 0));
        });

        it('inserts a bs:disable directive at line 0 in a brs/bs file', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();
            const action = findFileAction(program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22)), 'cannot-find-function');
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            expect(edits[0].newText).to.equal(`' bs:disable: cannot-find-function\n`);
            expect(edits[0].range).to.eql(util.createRange(0, 0, 0, 0));
        });

        it('inserts an XML-style bs:disable directive after the XML declaration', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            program.validate();
            const action = program.getCodeActions(file.srcPath, util.createRange(1, 5, 1, 5))
                .find(a => /^Disable .+ for this file/.test(a.title));
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            //inserted right after `?>` on line 0 with a leading newline so the directive sits on its own line
            expect(edits[0].newText.startsWith('\n<!-- bs:disable: ')).to.be.true;
            expect(edits[0].newText.endsWith(' -->')).to.be.true;
            expect(edits[0].range.start.line).to.equal(0);
        });

        it('inserts an XML-style bs:disable directive at line 0 when the <?xml ?> declaration is missing', () => {
            //Roku permits XML component files without the optional `<?xml ?>` declaration
            const file = program.setFile('components/comp1.xml', trim`
                <component name="comp1">
                </component>
            `);
            program.validate();
            const action = program.getCodeActions(file.srcPath, util.createRange(0, 5, 0, 5))
                .find(a => /^Disable .+ for this file/.test(a.title));
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            //no declaration to anchor to, so insert at the very top with a trailing newline
            expect(edits[0].newText.startsWith('<!-- bs:disable: ')).to.be.true;
            expect(edits[0].newText.endsWith(' -->\n')).to.be.true;
            expect(edits[0].range).to.eql(util.createRange(0, 0, 0, 0));
        });

        it('does not emit disable actions for diagnostics without a code', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                end sub
            `);
            program.validate();
            //inject a diagnostic with no code into the event
            const range = util.createRange(1, 16, 1, 16);
            const event: ProvideCodeActionsEvent = {
                program: program,
                file: file as BscFile,
                range: range,
                scopes: program.getScopesForFile(file),
                diagnostics: [{ code: undefined, message: 'no code', range: range, file: file } as any],
                codeActions: []
            };
            new CodeActionsProcessor(event).process();
            expect(event.codeActions.filter(a => /^Disable .+ for this/.test(a.title))).to.be.empty;
        });

        it('extends an existing bs:disable-next-line directive instead of inserting a new one', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    ' bs:disable-next-line: 9999
                    doSomething()
                end sub
            `);
            program.validate();
            //the diagnostic is on line 3 (the doSomething call). The existing directive sits on line 2.
            const action = findLineAction(program.getCodeActions(file.srcPath, util.createRange(3, 22, 3, 22)), 'cannot-find-function');
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            expect(edits).to.have.lengthOf(1);
            //replaces the existing comment with a merged version
            expect(edits[0].newText).to.equal(`' bs:disable-next-line: 9999 cannot-find-function`);
        });

        it('extends an existing trailing bs:disable-line directive', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    doSomething() ' bs:disable-line: 9999
                end sub
            `);
            program.validate();
            const action = findLineAction(program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22)), 'cannot-find-function');
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            expect(edits[0].newText).to.equal(`' bs:disable-line: 9999 cannot-find-function`);
        });

        it('extends an existing header-level bs:disable directive instead of inserting a new one', () => {
            const file = program.setFile('source/main.bs', `' bs:disable: 9999
                sub init()
                    doSomething()
                end sub
            `);
            program.validate();
            const action = findFileAction(program.getCodeActions(file.srcPath, util.createRange(2, 22, 2, 22)), 'cannot-find-function');
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            expect(edits[0].newText).to.equal(`' bs:disable: 9999 cannot-find-function`);
        });

        it('extends an existing XML header-level bs:disable directive', () => {
            const file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <!-- bs:disable: 9999 -->
                <component name="comp1">
                </component>
            `);
            program.validate();
            const action = program.getCodeActions(file.srcPath, util.createRange(2, 5, 2, 5))
                .find(a => /^Disable .+ for this file/.test(a.title));
            expect(action).to.exist;
            const edits = Object.values(action!.edit!.changes!)[0];
            //the new code is appended to the existing space-separated list
            //In this case "missing-extends-attribute"
            expect(/^<!-- bs:disable: 9999 [\w-]+ -->$/.test(edits[0].newText)).to.be.true;
        });

        it('does not duplicate the code when it is already in an existing directive', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    ' bs:disable-next-line: 9001
                    print "hello"
                end sub
            `);
            program.validate();
            //inject a synthetic diagnostic so we can exercise the no-op path with a code that's already listed in the existing directive
            const range = util.createRange(3, 22, 3, 22);
            const event: ProvideCodeActionsEvent = {
                program: program,
                file: file as BscFile,
                range: range,
                scopes: program.getScopesForFile(file),
                diagnostics: [{
                    code: 9001,
                    message: 'fake diagnostic',
                    location: util.createLocationFromFileRange(file, range)
                } as BsDiagnostic],
                codeActions: []
            };
            new CodeActionsProcessor(event).process();
            //the line action should be skipped (already in directive); the file action should still be available
            expect(findLineAction(event.codeActions, 9001)).to.be.undefined;
            expect(findFileAction(event.codeActions, 9001)).to.exist;
        });

        it('skips the line action when an existing directive suppresses all codes', () => {
            const file = program.setFile('source/main.bs', `
                sub init()
                    ' bs:disable-next-line
                    print "hello"
                end sub
            `);
            program.validate();
            const range = util.createRange(3, 22, 3, 22);
            const event: ProvideCodeActionsEvent = {
                program: program,
                file: file as BscFile,
                range: range,
                scopes: program.getScopesForFile(file),
                diagnostics: [{
                    code: 9001,
                    message: 'fake diagnostic',
                    location: util.createLocationFromFileRange(file, range)
                } as BsDiagnostic],
                codeActions: []
            };
            new CodeActionsProcessor(event).process();
            expect(findLineAction(event.codeActions, 9001)).to.be.undefined;
        });
    });
});
