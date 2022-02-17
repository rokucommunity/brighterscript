import { standardizePath as s, util } from '../util';
import { createSandbox } from 'sinon';
import { Program } from '../Program';
import { trim } from '../testHelpers.spec';
import type { XmlFile } from '../files/XmlFile';
import { expect } from 'chai';
import { TranspileState } from './TranspileState';
import type { SGComponent } from './SGTypes';
import { SGTag } from './SGTypes';
import { createSGComponent, createSGInterfaceField, createSGInterfaceFunction, createSGScript } from '../astUtils/creators';
const sinon = createSandbox();

describe('SGTypes', () => {
    let rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    const token = { text: '', range: util.createRange(1, 2, 3, 4) };

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: false });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('SGAttribute', () => {
        describe('key and value getters', () => {
            it('returns the value of the `key` token', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                    </component>
                `);
                expect(file.parser.ast.component.getAttribute('name').key).to.eql('name');
                expect(file.parser.ast.component.getAttribute('name').value).to.eql('Comp');
            });
        });

        describe('transpile', () => {
            it('skips value when not set', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp" something>
                    </component>
                `);
                expect(
                    file.parser.ast.component.getAttribute('something').transpile(new TranspileState(null, {})).toString()
                ).to.eql(
                    'something'
                );
            });
        });
    });

    describe('SGTag', () => {
        let tag: SGTag;
        beforeEach(() => {
            tag = new SGTag(token, token);
        });
        it('defaults attributes and childNodes to empty arrays if omitted', () => {
            expect(tag.attributes).to.exist.and.to.be.lengthOf(0);
            expect(tag.childNodes).to.exist.and.to.be.lengthOf(0);
        });

        describe('range getter', () => {
            it('handles null `attributes` prop', () => {
                tag.attributes = null;
                expect(tag.range).to.exist;
            });

            it('handles null `childNodes` prop', () => {
                tag.childNodes = null;
                expect(tag.range).to.exist;
            });
        });

        describe('id setter', () => {
            it('creates if missing', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                    </component>
                `);

                expect(file.ast.component.getAttribute('id')).not.to.exist;
                file.ast.component.id = 'someValue';
                expect(file.ast.component.getAttribute('id')).to.exist;
            });
        });

        describe('tagName getter', () => {
            it('returns null if missing startTagName', () => {
                tag.tokens.startTagName = null;
                expect(tag.tagName).not.to.exist;
            });
        });

        describe('removeChild', () => {
            it('removes the tag if found', () => {
                const child = tag.addChild(
                    new SGTag(token, token)
                );
                expect(
                    tag.removeChild(child)
                ).to.be.true;
            });

            it('does nothing if tag is not there', () => {
                const child = new SGTag(token, token);
                expect(
                    tag.removeChild(child)
                ).to.be.false;
            });
        });

        describe('setAttribute', () => {
            it('overwrites the attribute information if found', () => {
                tag.setAttributeValue('thing', 'firstValue');
                expect(tag.getAttribute('thing').value).to.eql('firstValue');

                tag.setAttributeValue('thing', 'secondValue');
                expect(tag.getAttribute('thing').value).to.eql('secondValue');
            });
        });

        describe('removeAttribute', () => {
            it('does nothing when attribute already missing', () => {
                expect(
                    tag.removeAttribute('notThere')
                ).to.be.false;
            });

            it('removes the attribute', () => {
                expect(tag.hasAttribute('someAttr')).to.be.false;

                tag.setAttributeValue('someAttr', 'someVal');
                expect(tag.hasAttribute('someAttr')).to.be.true;

                tag.removeAttribute('someAttr');
                expect(tag.hasAttribute('someAttr')).to.be.false;
            });
        });
    });

    describe('SGScript', () => {
        describe('type', () => {
            it('getter works', () => {
                const tag = createSGScript({ type: 'brightscript' });
                expect(tag.type).to.eql('brightscript');
            });
            it('setter works', () => {
                const tag = createSGScript({ type: 'brightscript' });
                tag.type = 'brighterscript';
                expect(tag.type).to.eql('brighterscript');
            });
        });
    });

    describe('SGInterfaceField', () => {
        it('value getter works', () => {
            const field = createSGInterfaceField('someField', { value: 'someValue' });
            expect(field.value).to.eql('someValue');
        });

        it('value setter works', () => {
            const field = createSGInterfaceField('someField');
            field.value = 'someValue';
            expect(field.value).to.eql('someValue');
        });

        it('onChange getter works', () => {
            const field = createSGInterfaceField('someField', { onChange: 'doSomething' });
            expect(field.onChange).to.eql('doSomething');
        });

        it('alwaysNotify getter works', () => {
            const field = createSGInterfaceField('someField', { alwaysNotify: 'true' });
            expect(field.alwaysNotify).to.eql('true');
        });
    });

    describe('SGInterfaceFunction', () => {
        it('name setter works', () => {
            const func = createSGInterfaceFunction('someFunc');
            expect(func.name).to.eql('someFunc');
            func.name = 'newName';
            expect(func.name).to.eql('newName');
        });
    });

    describe('SGComponent', () => {
        let comp: SGComponent;

        beforeEach(() => {
            comp = createSGComponent('comp');
        });

        describe('setInterfaceField', () => {
            it('creates interface node if missing', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                    </component>
                `);
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.empty;
                file.parser.ast.component.setInterfaceField('somePublicProp', 'string');
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).not.to.be.empty;
            });

            it('appends to existing interface node if present', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                    </component>
                `);
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.lengthOf(1);
                file.parser.ast.component.setInterfaceField('somePublicProp', 'string');
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.lengthOf(1);
            });

            it('appends to first interface node if present', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                        <interface></interface>
                    </component>
                `);
                let ifaces = file.parser.ast.component.getChildNodesByTagName('interface');
                expect(ifaces[0].childNodes).to.be.lengthOf(0);
                expect(ifaces[1].childNodes).to.be.lengthOf(0);

                file.parser.ast.component.setInterfaceField('somePublicProp', 'string');

                ifaces = file.parser.ast.component.getChildNodesByTagName('interface');
                expect(ifaces[0].childNodes).to.be.lengthOf(1);
                expect(ifaces[1].childNodes).to.be.lengthOf(0);
            });
        });

        describe('setInterfaceFunction', () => {
            it('creates interface node if missing', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                    </component>
                `);
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.empty;
                file.parser.ast.component.setInterfaceFunction('someFunc');
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).not.to.be.empty;
            });

            it('appends to existing interface node if present', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                    </component>
                `);
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.lengthOf(1);
                file.parser.ast.component.setInterfaceFunction('someFunc');
                expect(file.parser.ast.component.getChildNodesByTagName('interface')).to.be.lengthOf(1);
            });

            it('appends to first interface node if present', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                        <interface></interface>
                    </component>
                `);
                let ifaces = file.parser.ast.component.getChildNodesByTagName('interface');
                expect(ifaces[0].childNodes).to.be.lengthOf(0);
                expect(ifaces[1].childNodes).to.be.lengthOf(0);

                file.parser.ast.component.setInterfaceFunction('someFunc');

                ifaces = file.parser.ast.component.getChildNodesByTagName('interface');
                expect(ifaces[0].childNodes).to.be.lengthOf(1);
                expect(ifaces[1].childNodes).to.be.lengthOf(0);
            });
        });

        describe('hasInterfaceField', () => {
            it('returns false when no children', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceField('someField')).to.be.false;
            });

            it('returns false when field is missing', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface>
                            <field id="someField" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceField('otherField')).to.be.false;
            });

            it('finds field in first <interface> node', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface>
                            <field id="someField" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceField('someField')).to.be.true;
            });

            it('finds field in second <interface> node', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                        <interface>
                            <field id="someField" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceField('someField')).to.be.true;
            });
        });

        describe('hasInterfaceFunction', () => {
            it('returns false when no children', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceFunction('someFunc')).to.be.false;
            });

            it('returns false when func is missing', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface>
                            <function name="someFunc" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceFunction('otherFunc')).to.be.false;
            });

            it('finds func in first <interface> node', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface>
                            <function name="someFunc" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceFunction('someFunc')).to.be.true;
            });

            it('finds func in second <interface> node', () => {
                const file = program.setFile<XmlFile>('components/comp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Comp">
                        <interface></interface>
                        <interface>
                            <function name="someFunc" />
                        </interface>
                    </component>
                `);
                expect(file.ast.component.hasInterfaceFunction('someFunc')).to.be.true;
            });
        });

        describe('removeInterfaceField', () => {
            it('does not crash when interface missing', () => {
                expect(
                    comp.removeInterfaceField('nonExistantField')
                ).to.be.false;
            });

            it('removes field', () => {
                comp.setInterfaceField('someField', 'string');
                expect(
                    comp.hasInterfaceField('someField')
                ).to.be.true;

                comp.removeInterfaceField('someField');

                expect(
                    comp.hasInterfaceField('someField')
                ).to.be.false;
            });
        });

        describe('removeInterfaceFunction', () => {
            it('does not crash when interface missing', () => {
                expect(
                    comp.removeInterfaceFunction('fakeFunc')
                ).to.be.false;
            });

            it('removes field', () => {
                comp.setInterfaceFunction('someFunc');
                expect(
                    comp.hasInterfaceFunction('someFunc')
                ).to.be.true;

                comp.removeInterfaceFunction('someFunc');

                expect(
                    comp.hasInterfaceFunction('someFunc')
                ).to.be.false;
            });
        });
    });
});
