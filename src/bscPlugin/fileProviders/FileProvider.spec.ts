import { expect } from '../../chai-config.spec';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { expectDiagnostics, expectTypeToBe, expectZeroDiagnostics, outDir, rootDir, tempDir, trim } from '../../testHelpers.spec';
import { BooleanType, DynamicType, StringType } from '../../types';
import { ComponentType } from '../../types/ComponentType';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { standardizePath as s } from '../../util';
import { isAssetFile, isXmlFile } from '../../astUtils/reflection';

describe('FileProvider', () => {
    let program: Program;
    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            outDir: outDir
        });
    });

    afterEach(() => {
        program.dispose();
        fsExtra.removeSync(tempDir);
    });

    describe('anchor nodes', () => {
        const homeScreenSource = `
            import { FieldType } from '@roku-sdk/ts-core';
            import { registerAnchorNode } from '../registerTsComponents';

            const declaration = {
                componentName: 'HomeScreen',
                extends: 'Group' as const,
                inputFields: {
                    title: FieldType.String()
                },
                outputFields: {
                    closed: FieldType.Boolean(),
                    mystery: FieldType.SomethingNew()
                }
            };

            registerAnchorNode(declaration, (input, outputs) => {
                return <Label text={input.title} />;
            });
        `;

        function getComponentType(name: string) {
            return program.globalScope.symbolTable.getSymbolType(`roSGNode${name}`, { flags: SymbolTypeFlag.typetime }) as ComponentType;
        }

        it('registers the anchor node as a component', () => {
            program.setFile('components/HomeScreen.tsx', homeScreenSource);
            program.validate();
            expectZeroDiagnostics(program);
            expect(program.getComponent('HomeScreen')).to.exist;
            expect(program.hasSceneGraphNode('HomeScreen')).to.be.true;

            const componentType = getComponentType('HomeScreen');
            expectTypeToBe(componentType, ComponentType);
            expectTypeToBe(componentType.getMemberType('title', { flags: SymbolTypeFlag.runtime }), StringType);
            expectTypeToBe(componentType.getMemberType('closed', { flags: SymbolTypeFlag.runtime }), BooleanType);
            expectTypeToBe(componentType.getMemberType('mystery', { flags: SymbolTypeFlag.runtime }), DynamicType);
            //inherited from Group
            expect(componentType.getMemberType('translation', { flags: SymbolTypeFlag.runtime })?.isResolvable()).to.be.true;
        });

        it('keeps the TypeScript file as an asset', () => {
            const file = program.setFile('components/HomeScreen.tsx', homeScreenSource);
            expect(isAssetFile(file)).to.be.true;
            expect(isXmlFile(program.getFile('virtual:/anchorNodes/components/HomeScreen.tsx/HomeScreen.xml'))).to.be.true;
        });

        it('makes the anchor node available to brightscript', () => {
            program.setFile('components/HomeScreen.tsx', homeScreenSource);
            program.setFile('source/main.bs', `
                sub main()
                    node = CreateObject("roSGNode", "HomeScreen")
                    print node.title
                end sub

                sub useNode(node as roSGNodeHomeScreen)
                    isClosed = node.closed
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows xml components to extend anchor nodes', () => {
            program.setFile('components/HomeScreen.tsx', homeScreenSource);
            program.setFile('components/FancyHomeScreen.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="FancyHomeScreen" extends="HomeScreen">
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expectTypeToBe(getComponentType('FancyHomeScreen').getMemberType('closed', { flags: SymbolTypeFlag.runtime }), BooleanType);
        });

        it('removes the anchor node when the TypeScript file is removed', () => {
            program.setFile('components/HomeScreen.tsx', homeScreenSource);
            program.validate();
            expect(program.getComponent('HomeScreen')).to.exist;

            program.removeFile(s`${rootDir}/components/HomeScreen.tsx`);
            program.validate();
            expect(program.getComponent('HomeScreen')).not.to.exist;
            expect(program.hasFile('virtual:/anchorNodes/components/HomeScreen.tsx/HomeScreen.xml')).to.be.false;
            expect(getComponentType('HomeScreen')?.isResolvable()).not.to.be.true;
        });

        it('suppresses diagnostics in the virtual component', () => {
            program.setFile('components/Orphan.tsx', `
                registerAnchorNode({ componentName: 'Orphan', extends: 'DoesNotExist', inputFields: { a: FieldType.Mystery() } }, render);
            `);
            program.setFile('source/main.brs', `
                sub main()
                    node = CreateObject("roSGNode", "Unknown")
                end sub
            `);
            program.validate();
            //only the diagnostic from the real file remains
            expectDiagnostics(program, [
                DiagnosticMessages.unknownRoSGNode('Unknown')
            ]);
        });

        it('ignores declaration files and javascript', () => {
            program.setFile('components/HomeScreen.d.ts', homeScreenSource);
            program.setFile('components/bundle.js', homeScreenSource);
            expect(program.getComponent('HomeScreen')).not.to.exist;
        });

        it('does not write the virtual component to the output', async () => {
            program.setFile('components/HomeScreen.tsx', homeScreenSource);
            program.validate();
            await program.build();
            expect(fsExtra.pathExistsSync(s`${outDir}/components/HomeScreen.tsx`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${outDir}/components/anchorNodes`)).to.be.false;
        });
    });
});
