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
});
