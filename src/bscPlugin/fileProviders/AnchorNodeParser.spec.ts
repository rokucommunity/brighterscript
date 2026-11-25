import { expect } from '../../chai-config.spec';
import type { AnchorNodeDeclaration } from './AnchorNodeParser';
import { findAnchorNodeDeclarations, findImportSpecifiers } from './AnchorNodeParser';

describe('AnchorNodeParser', () => {
    describe('findAnchorNodeDeclarations', () => {
        /**
         * Find the declarations, without their positions
         */
        function find(text: string): Omit<AnchorNodeDeclaration, 'position'>[] {
            return findAnchorNodeDeclarations(text).map(({ position, ...rest }) => rest);
        }

        it('returns nothing for files that are not RSG 2.0 sources', () => {
            expect(find(`const x = { componentName: 'Foo', extends: 'Group' };`)).to.eql([]);
            expect(find(`import { FieldType } from '@roku-sdk/rsg-ts';`)).to.eql([]);
            expect(find(undefined)).to.eql([]);
        });

        it('finds a descriptor passed to defineAnchorNode', () => {
            expect(find(`
                import { type AnchorNodeImplementation, defineAnchorNode, FieldType } from "@roku-sdk/rsg-ts";

                const HomeScreenDescriptor = {
                    componentName: "HomeScreen",
                    extends: "Group" as const,
                    inputFields: {
                        title: FieldType.String(""),
                        itemCount: FieldType.Number(3)
                    },
                    outputFields: {
                        closed: FieldType.Boolean()
                    }
                };

                const HomeScreen: AnchorNodeImplementation<typeof HomeScreenDescriptor> = (inputs, outputs) => {
                    return <label text={inputs.title} />;
                };

                export default defineAnchorNode(HomeScreenDescriptor, HomeScreen);
            `)).to.eql([{
                componentName: 'HomeScreen',
                extends: 'Group',
                fields: [
                    { name: 'title', direction: 'input', type: 'string' },
                    { name: 'itemCount', direction: 'input', type: 'integer' },
                    { name: 'closed', direction: 'output', type: 'boolean' }
                ]
            }]);
        });

        it('finds an exported descriptor that is registered from another file', () => {
            expect(find(`
                import { FieldType } from "@roku-sdk/rsg-ts";
                export const MenuDescription = {
                    componentName: "Menu",
                    extends: "Group",
                    inputFields: {},
                    outputFields: {}
                };
            `).map(x => x.componentName)).to.eql(['Menu']);
        });

        it('finds an inline descriptor passed to a custom register function', () => {
            expect(find(`
                import { registerAnchorNode } from '../registerTsComponents';
                registerAnchorNode({ componentName: 'Banner', extends: 'Rectangle', inputFields: { color: FieldType.String() } }, () => <></>);
            `)).to.eql([{
                componentName: 'Banner',
                extends: 'Rectangle',
                fields: [
                    { name: 'color', direction: 'input', type: 'string' }
                ]
            }]);
        });

        it('finds multiple descriptors in one file', () => {
            expect(find(`
                declareTsComponent({ componentName: 'One', extends: 'Group' }, OneImpl);
                const two = { componentName: 'Two', extends: 'Group' };
                declareTsComponent(two, TwoImpl);
            `).map(x => x.componentName)).to.eql(['One', 'Two']);
        });

        it('includes the libraryName and the position of the descriptor', () => {
            expect(findAnchorNodeDeclarations(`import { FieldType } from "@roku-sdk/rsg-ts";\nconst d = {\n    componentName: "Cowboy",\n    extends: "Group",\n    libraryName: "tsDCL"\n};`)).to.eql([{
                componentName: 'Cowboy',
                extends: 'Group',
                libraryName: 'tsDCL',
                fields: [],
                position: { line: 1, character: 10 }
            }]);
        });

        it('supports type annotations, satisfies, and quoted keys', () => {
            expect(find(`
                export const declaration: AnchorNodeDescriptor = {
                    componentName: \`Typed\`,
                    extends: 'Group',
                    inputFields: {
                        'quoted-name': FieldType.Float(1.5),
                    },
                } satisfies AnchorNodeDescriptor;
            `)).to.eql([{
                componentName: 'Typed',
                extends: 'Group',
                fields: [
                    { name: 'quoted-name', direction: 'input', type: 'float' }
                ]
            }]);
        });

        it('maps every FieldType to the field type the device creates', () => {
            const result = find(`
                const d = {
                    componentName: 'Types',
                    inputFields: {
                        a: FieldType.Boolean(false),
                        b: FieldType.Number(),
                        c: FieldType.Float(),
                        d: FieldType.String(),
                        e: FieldType.Array([1, 2]),
                        f: FieldType.Object({ x: 1 }),
                        g: FieldType.Null(),
                        h: FieldType.SomethingNew(),
                        i: someHelper
                    }
                };
            `);
            expect(result[0].fields.map(x => x.type)).to.eql([
                'boolean',
                'integer',
                'float',
                'string',
                'array',
                'assocarray',
                'assocarray',
                undefined,
                undefined
            ]);
        });

        it('ignores comments and strings that look like descriptors', () => {
            expect(find(`
                // const a = { componentName: 'Commented', extends: 'Group' };
                /* const b = { componentName: 'Blocked', extends: 'Group' }; */
                const text = "{ componentName: 'Quoted', extends: 'Group' }";
                const pattern = /{ componentName: 'Regex' }/g;
                const real = { componentName: 'Real', extends: 'Group' };
                defineAnchorNode(real, Impl);
            `).map(x => x.componentName)).to.eql(['Real']);
        });

        it('recovers from JSX text containing apostrophes', () => {
            expect(find(`
                const Other = () => <Text>Don't break the scanner</Text>;
                const d = { componentName: 'AfterJsx', outputFields: { done: FieldType.Boolean() } };
            `)).to.eql([{
                componentName: 'AfterJsx',
                extends: undefined,
                fields: [{ name: 'done', direction: 'output', type: 'boolean' }]
            }]);
        });

        it('skips objects that are not descriptors', () => {
            expect(find(`
                import { FieldType } from "@roku-sdk/rsg-ts";
                const onlyName = { componentName: 'OnlyName' };
                const computed = { componentName: \`Name\${suffix}\`, extends: 'Group' };
                const badName = { componentName: 'bad name', extends: 'Group' };
                const notAString = { componentName: getName(), extends: 'Group' };
            `)).to.eql([]);
        });

        it('skips spreads, shorthand properties, and methods', () => {
            expect(find(`
                const d = {
                    ...baseDeclaration,
                    componentName: 'Spread',
                    shorthand,
                    method() { return { other: true }; },
                    inputFields: { ...sharedFields, own: FieldType.Float() }
                };
            `)).to.eql([{
                componentName: 'Spread',
                extends: undefined,
                fields: [{ name: 'own', direction: 'input', type: 'float' }]
            }]);
        });
    });

    describe('findImportSpecifiers', () => {
        it('finds every kind of import', () => {
            expect(findImportSpecifiers(`
                import Default from "./default";
                import * as everything from './everything';
                import { a, type B } from "./named";
                import type { C } from "./types";
                import "./side-effect.xml";
                export * from "./re-export";
                export { d } from './re-export-named';
                const lazy = await import("./lazy");
                const old = require('./old');
            `)).to.eql([
                './default',
                './everything',
                './named',
                './types',
                './side-effect.xml',
                './re-export',
                './re-export-named',
                './lazy',
                './old'
            ]);
        });

        it('ignores strings that are not imports', () => {
            expect(findImportSpecifiers(`
                // import "./commented";
                const text = "./not-an-import";
                console.log(\`import "./in-template"\`);
                <Label text="from" />
            `)).to.eql([]);
        });
    });
});
