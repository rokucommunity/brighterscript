import { expect } from 'chai';
import { URI } from 'vscode-uri';
import { Program } from '../../Program';
import { expectCodeActions, trim } from '../../testHelpers.spec';
import { standardizePath as s, util } from '../../util';

const rootDir = s`${process.cwd()}/.tmp/rootDir`;
describe('CodeActionsProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('getCodeActions', () => {
        it('suggests `extends=Group`', () => {
            const file = program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            expectCodeActions(() => {
                program.getCodeActions(
                    file.pathAbsolute,
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
            const file = program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" attr2="attr3" attr3="attr3">
                </component>
            `);
            const codeActions = program.getCodeActions(
                file.pathAbsolute,
                //<comp|onent name="comp1">
                util.createRange(1, 5, 1, 5)
            );

            expect(
                codeActions[0].edit.changes[URI.file(s`${rootDir}/components/comp1.xml`).toString()][0].range
            ).to.eql(
                util.createRange(1, 51, 1, 51)
            );
        });

        it('does not produce duplicate code actions for bs imports', () => {
            //define the function in two files
            program.addOrReplaceFile('components/lib1.brs', `
                sub doSomething()
                end sub
            `);
            program.addOrReplaceFile('components/lib2.brs', `
                sub doSomething()
                end sub
            `);

            //use the function in this file
            const componentCommonFile = program.addOrReplaceFile('components/ComponentCommon.bs', `
                sub init()
                    doSomething()
                end sub
            `);

            //import the file in two scopes
            program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="ComponentCommon.bs" />
                </component>
            `);
            program.addOrReplaceFile('components/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="ComponentCommon.bs" />
                </component>
            `);

            program.validate();

            //we should only get each file import suggestion exactly once
            const codeActions = program.getCodeActions(
                componentCommonFile.pathAbsolute,
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
            program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.brs" />
                </component>
            `);
            //import the function here
            const file = program.addOrReplaceFile('components/comp1.brs', `
                sub init()
                    DoSomething()
                end sub
            `);

            //define the function here
            program.addOrReplaceFile('source/lib.brs', `
                sub DoSomething()
                end sub
            `);

            program.validate();

            //there should be no code actions since this is a brs file
            const codeActions = program.getCodeActions(
                file.pathAbsolute,
                // DoSometh|ing()
                util.createRange(2, 28, 2, 28)
            );
            expect(codeActions).to.be.empty;
        });

        it('suggests class imports', () => {
            //import the file in two scopes
            program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.bs" />
                </component>
            `);
            const file = program.addOrReplaceFile('components/comp1.bs', `
                sub init()
                    dude = new Person()
                end sub
            `);

            program.addOrReplaceFile('source/Person.bs', `
                class Person
                end class
            `);

            program.validate();

            expect(
                program.getCodeActions(
                    file.pathAbsolute,
                    // new Per|son()
                    util.createRange(2, 34, 2, 34)
                ).map(x => x.title).sort()
            ).to.eql([
                `import "pkg:/source/Person.bs"`
            ]);
        });

        it('suggests class imports', () => {
            //import the file in two scopes
            program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                    <script uri="comp1.bs" />
                </component>
            `);
            //import the function here
            const file = program.addOrReplaceFile('components/comp1.bs', `
                sub init()
                    kitty = new Animals.Cat()
                end sub
            `);
            program.addOrReplaceFile('source/Animals.bs', `
                namespace Animals
                    class Cat
                    end class
                end namespace
            `);

            program.validate();

            expect(
                program.getCodeActions(
                    file.pathAbsolute,
                    // new Anim|als.Cat()
                    util.createRange(2, 36, 2, 36)
                ).map(x => x.title).sort()
            ).to.eql([
                `import "pkg:/source/Animals.bs"`
            ]);
        });

        it('suggests callfunc operator refactor', () => {
            //define the function in two files
            const file = program.addOrReplaceFile('components/main.bs', `
                sub doSomething()
                    someComponent.callfunc("doThing")
                    someComponent.callfunc("doOtherThing", 1, 2)
                end sub
            `);
            program.validate();

            expectCodeActions(() => {
                program.getCodeActions(
                    file.pathAbsolute,
                    util.createRange(2, 39, 2, 39)
                );
            }, [{
                title: `Refactor to use callfunc operator`,
                isPreferred: false,
                kind: 'quickfix',
                changes: [{
                    filePath: file.pathAbsolute,
                    newText: '@.doThing(',
                    type: 'replace',
                    range: util.createRange(2, 33, 2, 52)
                }]
            }]);

            expectCodeActions(() => {
                program.getCodeActions(
                    file.pathAbsolute,
                    util.createRange(3, 39, 3, 39)
                );
            }, [{
                title: `Refactor to use callfunc operator`,
                isPreferred: false,
                kind: 'quickfix',
                changes: [{
                    filePath: file.pathAbsolute,
                    newText: '@.doOtherThing(',
                    type: 'replace',
                    range: util.createRange(3, 33, 3, 59)
                }]
            }]);
        });
    });

});
