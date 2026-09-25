import { expect } from '../chai-config.spec';
import { trim } from '../testHelpers.spec';
import { SGChildren, SGComponent, SGField, SGFunction, SGInterface, SGNode, SGScript } from './SGTypes';
import { TranspileState } from './TranspileState';

/**
 * These tests build the SG AST programmatically (the way a plugin would) WITHOUT
 * providing a `closingTag`. They prove that every affected tag type still behaves
 * correctly when `closingTag` is absent, guaranteeing backwards compatibility with
 * any code (parser or plugin) that constructs these nodes the old way.
 */
describe('SGTypes', () => {
    function transpile(tag: SGNode): string {
        return tag.transpile(new TranspileState('pkg:/components/Comp.xml', { rootDir: '' })).toString();
    }

    describe('backwards compatibility (no closingTag provided)', () => {
        it('SGNode leaves closingTag undefined and derives the closing tag from the opening tag', () => {
            const node = new SGNode({ text: 'Group' }, [], [
                new SGNode({ text: 'Label' })
            ]);
            expect(node.closingTag).to.be.undefined;
            //closing tag in the output is derived from the opening tag name, not from closingTag
            expect(transpile(node)).to.equal(trim`
                <Group>
                    <Label />
                </Group>
            ` + '\n');
        });

        it('SGNode with no children transpiles as self-closing', () => {
            const node = new SGNode({ text: 'Group' });
            expect(node.closingTag).to.be.undefined;
            expect(transpile(node)).to.equal('<Group />\n');
        });

        it('SGChildren defaults work without closingTag', () => {
            const children = new SGChildren();
            expect(children.closingTag).to.be.undefined;
            expect(children.tag.text).to.equal('children');
            expect(children.getChildren()).to.eql([]);
        });

        it('SGScript works without closingTag', () => {
            const script = new SGScript();
            expect(script.closingTag).to.be.undefined;
            //defaults to text/brightscript when no attributes provided
            expect(script.type).to.equal('text/brightscript');
            expect(script.getChildren()).to.eql([]);
        });

        it('SGField works without closingTag', () => {
            const field = new SGField();
            expect(field.closingTag).to.be.undefined;
            expect(field.tag.text).to.equal('field');
            expect(field.getChildren()).to.eql([]);
        });

        it('SGFunction works without closingTag', () => {
            const func = new SGFunction();
            expect(func.closingTag).to.be.undefined;
            expect(func.tag.text).to.equal('function');
            expect(func.getChildren()).to.eql([]);
        });

        it('SGInterface works without closingTag and reports its children', () => {
            const field = new SGField({ text: 'field' }, [{ key: { text: 'id' }, value: { text: 'foo' } }]);
            const func = new SGFunction({ text: 'function' }, [{ key: { text: 'name' }, value: { text: 'bar' } }]);
            const iface = new SGInterface({ text: 'interface' }, [field, func]);
            expect(iface.closingTag).to.be.undefined;
            expect(iface.getChildren()).to.eql([field, func]);
        });

        it('SGComponent works without closingTag and reports its children', () => {
            const iface = new SGInterface();
            const script = new SGScript();
            const children = new SGChildren();
            const component = new SGComponent({ text: 'component' }, [], [iface, script, children]);
            expect(component.closingTag).to.be.undefined;
            expect(component.getChildren()).to.eql([iface, script, children]);
        });

        it('a deeply nested tree built without closingTag transpiles with matching closing tags', () => {
            const node = new SGNode({ text: 'Group' }, [], [
                new SGNode({ text: 'Rectangle' }, [], [
                    new SGNode({ text: 'Label' })
                ])
            ]);
            expect(transpile(node)).to.equal(trim`
                <Group>
                    <Rectangle>
                        <Label />
                    </Rectangle>
                </Group>
            ` + '\n');
        });
    });
});
