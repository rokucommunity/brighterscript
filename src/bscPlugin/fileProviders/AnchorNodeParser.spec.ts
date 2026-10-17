import { expect } from '../../chai-config.spec';
import { findAnchorNodeDeclarations } from './AnchorNodeParser';

describe('AnchorNodeParser', () => {
    describe('findAnchorNodeDeclarations', () => {
        it('returns nothing for files without registerAnchorNode', () => {
            expect(findAnchorNodeDeclarations(`const x = { componentName: 'Foo' };`)).to.eql([]);
            expect(findAnchorNodeDeclarations(undefined)).to.eql([]);
        });

        it('finds a declaration stored in a variable', () => {
            expect(findAnchorNodeDeclarations(`
                import { FieldType } from '@roku-sdk/ts-core';
                import { registerAnchorNode } from './register';

                const declaration = {
                    componentName: 'HomeScreen',
                    extends: 'Group' as const,
                    inputFields: {
                        title: FieldType.String(),
                        itemCount: FieldType.Integer()
                    },
                    outputFields: {
                        closed: FieldType.Boolean()
                    }
                };

                registerAnchorNode(declaration, (input, outputs) => {
                    return <Label text={input.title} />;
                });
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

        it('finds an inline declaration', () => {
            expect(findAnchorNodeDeclarations(`
                registerAnchorNode({ componentName: "Banner", extends: "Rectangle", inputFields: { color: FieldType.Color() } }, () => <></>);
            `)).to.eql([{
                componentName: 'Banner',
                extends: 'Rectangle',
                fields: [
                    { name: 'color', direction: 'input', type: 'color' }
                ]
            }]);
        });

        it('finds multiple declarations in one file', () => {
            const result = findAnchorNodeDeclarations(`
                registerAnchorNode({ componentName: 'One' }, () => <></>);
                const two = { componentName: 'Two', extends: 'Group' };
                registerAnchorNode(two, () => <></>);
            `);
            expect(result.map(x => x.componentName)).to.eql(['One', 'Two']);
        });

        it('supports type annotations, satisfies, and type arguments', () => {
            const result = findAnchorNodeDeclarations(`
                export const declaration: AnchorDeclaration<Foo> = {
                    componentName: \`Typed\`,
                    extends: 'Group',
                    inputFields: {
                        'quoted-name': FieldType.Node<ContentNode>(),
                    },
                } satisfies AnchorDeclaration;
                sdk.registerAnchorNode<typeof declaration>(declaration, render);
            `);
            expect(result).to.eql([{
                componentName: 'Typed',
                extends: 'Group',
                fields: [
                    { name: 'quoted-name', direction: 'input', type: 'node' }
                ]
            }]);
        });

        it('maps field type aliases and array item types', () => {
            const result = findAnchorNodeDeclarations(`
                registerAnchorNode({
                    componentName: 'Types',
                    inputFields: {
                        a: FieldType.Number(),
                        b: FieldType.AssociativeArray(),
                        c: FieldType.Array(FieldType.String()),
                        d: FieldType.Array(),
                        e: FieldType.Vector2D(),
                        f: FieldType.SomethingNew(),
                        g: someHelper,
                        h: 'boolean'
                    }
                }, render);
            `);
            expect(result[0].fields.map(x => x.type)).to.eql([
                'float',
                'assocarray',
                'stringarray',
                'array',
                'vector2d',
                undefined,
                undefined,
                'boolean'
            ]);
        });

        it('ignores comments, strings, and regular expressions that look like declarations', () => {
            const result = findAnchorNodeDeclarations(`
                // registerAnchorNode({ componentName: 'Commented' }, render);
                /* registerAnchorNode({ componentName: 'Blocked' }, render); */
                const text = "registerAnchorNode({ componentName: 'Quoted' }, render)";
                const pattern = /registerAnchorNode\\(\\{/g;
                registerAnchorNode({ componentName: 'Real' }, render);
            `);
            expect(result.map(x => x.componentName)).to.eql(['Real']);
        });

        it('recovers from JSX text containing apostrophes', () => {
            const result = findAnchorNodeDeclarations(`
                const Other = () => <Text>Don't break the scanner</Text>;
                registerAnchorNode({ componentName: 'AfterJsx', outputFields: { done: FieldType.Boolean() } }, render);
            `);
            expect(result).to.eql([{
                componentName: 'AfterJsx',
                extends: undefined,
                fields: [{ name: 'done', direction: 'output', type: 'boolean' }]
            }]);
        });

        it('skips the function definition and declarations it cannot read', () => {
            const result = findAnchorNodeDeclarations(`
                export function registerAnchorNode(declaration, render) { }
                registerAnchorNode(importedDeclaration, render);
                registerAnchorNode(buildDeclaration(), render);
                registerAnchorNode({ componentName: \`Name\${suffix}\` }, render);
                registerAnchorNode({ componentName: 'bad name' }, render);
            `);
            expect(result).to.eql([]);
        });

        it('skips spreads, shorthand properties, and methods', () => {
            const result = findAnchorNodeDeclarations(`
                registerAnchorNode({
                    ...baseDeclaration,
                    componentName: 'Spread',
                    shorthand,
                    method() { return { componentName: 'Wrong' }; },
                    inputFields: { ...sharedFields, own: FieldType.Float() }
                }, render);
            `);
            expect(result).to.eql([{
                componentName: 'Spread',
                extends: undefined,
                fields: [{ name: 'own', direction: 'input', type: 'float' }]
            }]);
        });
    });
});
