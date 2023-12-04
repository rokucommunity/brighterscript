/* eslint-disable @typescript-eslint/await-thenable */
import util, { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, stagingDir, tempDir } from '../../../testHelpers.spec';
import { expect } from 'chai';
import type { BrsFile } from '../../../files/BrsFile';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { createVisitor, WalkMode } from '../../../astUtils/visitors';
import * as sinon from 'sinon';
import { ParseMode } from '../../Parser';
import * as fsExtra from 'fs-extra';
import { TypeExpression } from '../../..';

describe('ComponentStatement', () => {
    const rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, stagingDir: stagingDir });
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('supports identifier-style component names', () => {
        program.setFile(`source/MyButton.bs`, `
            component MyButton extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports string component names', () => {
        program.setFile(`source/MyButton.bs`, `
            component "my-button" extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports identifier-style parent name', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            component CustomButton
            end component
            component "my-button" extends CustomButton
            end component
        `);
        expectZeroDiagnostics(program);
        const parentName = file.parser.references.componentStatements[1].parentName as TypeExpression;
        expect(parentName).to.be.instanceof(TypeExpression);
        expect(parentName.getName(ParseMode.BrightScript)).to.eql('CustomButton');
    });

    it('supports namespaced parent name', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            namespace Buttons
                component CustomButton
                end component
            end namespace
            component "my-button" extends Buttons.CustomButton
            end component
        `);
        expectZeroDiagnostics(program);
        const parentName = file.parser.references.componentStatements[1].parentName as TypeExpression;
        expect(parentName).to.be.instanceof(TypeExpression);
        expect(parentName.getName(ParseMode.BrighterScript)).to.eql('Buttons.CustomButton');
    });

    it('supports string parent name', () => {
        program.setFile(`source/MyButton.bs`, `
            component "my-button" extends "button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports multiple components in a file', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            component Button1 extends "Button"
            end component

            component Button2 extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
        expect(
            file.parser.references.componentStatements.map(x => x.name)
        ).to.eql([
            'Button1',
            'Button2'
        ]);
    });

    it('catches weird component names, and recovers for next component in the file', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            component Bogus.Name extends "Button"
            end component

            component ValidName extends "Button"
            end component
        `);
        expect(
            file.parser.references.componentStatements.map(x => x.name)
        ).to.include(
            'ValidName'
        );
    });

    it('mandates member access modifiers', () => {
        program.setFile<BrsFile>(`source/MyButton.bs`, `
            component MyButton extends "Button"
                name as string
                function getName()
                end function
            end component
        `);
        program.validate();
        expectDiagnostics(program, [
            {
                ...DiagnosticMessages.accessModifierIsRequired(),
                range: util.createRange(2, 16, 2, 20)
            },
            {
                ...DiagnosticMessages.accessModifierIsRequired(),
                range: util.createRange(3, 25, 3, 32)
            }
        ]);
    });

    it('is walkable', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            component MyButton extends "Button"
                name as string
                function getName()
                end function
            end component
        `);
        const componentSpy = sinon.spy();
        const fieldSpy = sinon.spy();
        const methodSpy = sinon.spy();
        file.ast.walk(createVisitor({
            ComponentStatement: componentSpy,
            FieldStatement: fieldSpy,
            MethodStatement: methodSpy
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
        expect(
            componentSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0]
        );
        expect(
            fieldSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0].body[0]
        );
        expect(
            methodSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0].body[1]
        );
    });

    it('moves component statements from pkg:/source into pkg:/components', () => {
        program.setFile('source/MainScene.bs', `
            component MainScene
            end component
        `);

        expect(
            program.getFile('components/MainScene.xml')
        ).to.exist;
    });

    it('moves component statements from nested pkg:/source into pkg:/components', () => {
        program.setFile('source/nested/path/MainScene.bs', `
            component MainScene
            end component
        `);

        expect(
            program.getFile('components/nested/path/MainScene.xml')
        ).to.exist;
    });

    it('produces xml output when built', async () => {
        program.setFile('components/MainScene.bs', `
            component MainScene
            end component
        `);

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await testTranspile(program.getFile('components/MainScene.xml'), `
            <component name="MainScene" extends="Group">
                <script uri="pkg:/components/MainScene.brs" type="text/brightscript" />
                <script uri="pkg:/components/MainScene.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);
    });

    it('produces an xml file for each component when built', async () => {
        program.setFile('components/MainScene.bs', `
            component MainScene
            end component

            component AlternateScene
            end component
        `);

        await testTranspile(program.getFile('components/MainScene.xml'), `
            <component name="MainScene" extends="Group">
                <script uri="pkg:/components/MainScene.brs" type="text/brightscript" />
                <script uri="pkg:/components/MainScene.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);

        await testTranspile(program.getFile('components/AlternateScene.xml'), `
            <component name="AlternateScene" extends="Group">
                <script uri="pkg:/components/MainScene.brs" type="text/brightscript" />
                <script uri="pkg:/components/AlternateScene.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);
    });

    it('produces a codebehind file for each component', async () => {
        program.setFile('components/MainScene.bs', `
            component MainScene
                private sub init()
                    print "MainScene"
                end sub
            end component
        `);

        await testTranspile(program.getFile('components/MainScene.xml'), `
            <component name="MainScene" extends="Group">
                <script uri="pkg:/components/MainScene.brs" type="text/brightscript" />
                <script uri="pkg:/components/MainScene.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);

        await testTranspile(program.getFile('components/MainScene.codebehind.bs'), `
            sub init()
                print "MainScene"
            end sub
        `);
    });

    it('adds public members to the xml interface', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard

                public isEnabled as boolean

                public sub EnableVoiceMode(isEnabled as boolean)
                    m.top.voiceModeEnabled = isEnabled
                end sub

            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <interface>
                    <field id="isEnabled" type="boolean" />
                    <function name="EnableVoiceMode" />
                </interface>
            </component>
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub EnableVoiceMode(isEnabled as boolean)
                m.top.voiceModeEnabled = isEnabled
            end sub
        `);
    });

    it.skip('adds private member to m and creates init function if missing', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                private isEnabled = true
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub init()
                m.isEnabled = true
            end sub
        `);
    });

    it('adds private member to start of existing init function', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                private sub init()
                    'test
                end sub
                private isEnabled = true
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub init()
                m.isEnabled = true
                'test
            end sub
        `);
    });

    it('adds private methods to codebehind as plain functions', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                private sub init()
                    'test
                end sub
                private sub doSomething()
                    print "do something"
                end sub
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub init()
                'test
            end sub

            sub doSomething()
                print "do something"
            end sub
        `);
    });

    it('rewrites m method calls', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                private sub init()
                    m.doSomething()
                end sub
                private sub doSomething()
                    print "do something"
                end sub
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub init()
                doSomething()
            end sub

            sub doSomething()
                print "do something"
            end sub
        `);
    });

    it('includes xml template', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            @template(\`
                <label />
            \`)
            component ZombieKeyboard
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <children>
                    <label />
                </children>
            </component>
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
        `);
    });

    it('support initialFocus annotation', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            @template(\`
                <label id="theLabel" />
            \`)
            @initialFocus(m.theLabel)
            component ZombieKeyboard
            end component
        `);


        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group" initialFocus="theLabel">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <children>
                    <label id="theLabel" />
                </children>
            </component>
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
        `);
    });

    it('support alwaysNotify annotations on interface fields', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                @alwaysNotify(true)
                public testField as string
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <interface>
                    <field id="testField" type="string" alwaysNotify="true" />
                </interface>
            </component>
        `);
    });

    it('support alias annotations on interface fields', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            @template(\`
                <label id="theLabel" />
                <label id="theOtherLabel" />
            \`)
            component ZombieKeyboard
                @alias("theLabel.text")
                @alias("theOtherLabel.text")
                @alias("theOtherLabel.text", "theLabel.text")
                @alias("theLabel.text", "theOtherLabel.text")
                public testField as string
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <interface>
                    <field id="testField" type="string" alias="theLabel.text, theOtherLabel.text" />
                </interface>
                <children>
                    <label id="theLabel" />
                    <label id="theOtherLabel" />
                </children>
            </component>
        `);
    });

    it('support onChange annotations on interface fields', async () => {
        program.setFile('components/ZombieKeyboard.bs', `
            component ZombieKeyboard
                @onChange(m.doSomething)
                public testField as string

                private sub doSomething()
                    print "do something"
                end sub
            end component
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.codebehind.bs'), `
            sub doSomething()
                print "do something"
            end sub
        `);

        await testTranspile(program.getFile('components/ZombieKeyboard.xml'), `
            <component name="ZombieKeyboard" extends="Group">
                <script uri="pkg:/components/ZombieKeyboard.brs" type="text/brightscript" />
                <script uri="pkg:/components/ZombieKeyboard.codebehind.brs" type="text/brightscript" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <interface>
                    <field id="testField" type="string" onChange="doSomething" />
                </interface>
            </component>
        `);
    });
});
