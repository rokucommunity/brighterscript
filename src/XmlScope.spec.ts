import { expect } from './chai-config.spec';
import { Position, Range } from 'vscode-languageserver';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import { expectDiagnostics, expectTypeToBe, expectZeroDiagnostics, trim } from './testHelpers.spec';
import { standardizePath as s, util } from './util';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
import { ComponentType } from './types/ComponentType';
import { SymbolTypeFlag } from './SymbolTable';
import { AssociativeArrayType } from './types/AssociativeArrayType';
import { ArrayType, BooleanType, DoubleType, DynamicType, FloatType, IntegerType, StringType, TypedFunctionType, UnionType } from './types';
const sinon = createSandbox();

describe('XmlScope', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        sinon.restore();
    });

    afterEach(() => {
        program.dispose();
        sinon.restore();
    });

    describe('constructor', () => {
        it('listens for attach/detach parent events', () => {
            let parentXmlFile = program.setFile<XmlFile>('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Parent" extends="Scene">
                </component>
            `);
            let scope = program.getScopeByName(parentXmlFile.destPath);

            //should default to global scope
            expect(scope.getParentScope()).to.equal(program.globalScope);

            let childXmlFile = program.setFile<XmlFile>('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child" extends="Parent">
                </component>
            `);
            let childScope = program.getComponentScope('Child')!;

            program.validate();

            // child should have found its parent
            expect(childXmlFile.parentComponent).to.equal(parentXmlFile);
            // child's parent scope should have found the parent scope
            expect(childScope.getParentScope()).to.equal(program.getComponentScope('Parent'));

            //remove the parent component
            program.removeFile(`${rootDir}/components/parent.xml`);
            program.validate();
            //the child should know the parent no longer exists
            expect(childXmlFile.parentComponent).not.to.exist;
            //child's parent scope should be the global scope
            expect(childScope.getParentScope()).to.equal(program.globalScope);
        });
    });

    describe('getDefinition', () => {
        it('finds parent file', () => {
            let parentXmlFile = program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentComponent">
                </component>
            `);
            let childXmlFile = program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildComponent" extends="ParentComponent">
                </component>
            `);
            let childScope = program.getScopesForFile(childXmlFile);
            let definition = childScope[0].getDefinition(childXmlFile, Position.create(1, 48));
            expect(definition).to.be.lengthOf(1);
            expect(definition[0].uri).to.equal(util.pathToUri(parentXmlFile.srcPath));
        });
    });

    describe('getFiles', () => {
        it('includes the xml file', () => {
            let xmlFile = program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child">
                </component>
            `);
            program.validate();
            expect(program.getComponentScope('Child')!.getOwnFiles()[0]).to.equal(xmlFile);
        });
    });

    describe('validate', () => {
        it('adds an error when an interface function cannot be found', () => {
            program = new Program({ rootDir: rootDir });

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <interface>
                        <function name="func1" />
                        <function name="func2" />
                        <function id="func3" />
                        <function name="" />
                        <function name />
                        <field id="field1" type="string" onChange="func4" />
                    </interface>
                    <script uri="child.brs"/>
                </component>
            `);
            program.setFile(s`components/child.brs`, `
                sub func1()
                end sub
            `);
            program.validate();
            let childScope = program.getComponentScope('child')!;
            expectDiagnostics(childScope, [{
                ...DiagnosticMessages.xmlFunctionNotFound('func2'),
                range: Range.create(4, 24, 4, 29)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(5, 9, 5, 17)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(6, 9, 6, 17)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(7, 9, 7, 17)
            }, { // syntax error expecting '=' but found '/>'
                code: DiagnosticMessages.xmlGenericParseError('').code
            }, { // onChange function
                ...DiagnosticMessages.xmlFunctionNotFound('func4'),
                range: Range.create(8, 51, 8, 56)
            }]);
        });

        it('adds an error when an interface field is invalid', () => {
            program = new Program({ rootDir: rootDir });

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <interface>
                        <field id="field1" type="node" />
                        <field id="field2" type="no" />
                        <field id="field3" />
                        <field name="field4" type="str" />
                        <field id="field5" alias="other.field" />
                        <field id="" type="int" />
                        <field id />
                    </interface>
                    <script uri="child.brs"/>
                </component>
            `);
            program.setFile(s`components/child.brs`, `
                sub init()
                end sub
            `);
            program.validate();
            expectDiagnostics(program.getComponentScope('child')!, [{
                ...DiagnosticMessages.xmlInvalidFieldType('no'),
                range: Range.create(4, 33, 4, 35)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'type'),
                range: Range.create(5, 9, 5, 14)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(6, 9, 6, 14)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(8, 9, 8, 14)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(9, 9, 9, 14)
            }, {
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'type'),
                range: Range.create(9, 9, 9, 14)
            }, { // syntax error expecting '=' but found '/>'
                code: DiagnosticMessages.xmlGenericParseError('').code
            }]);
        });
    });

    describe('symbols and types', () => {
        it('adds the component type to the global symbol table', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                    </interface>
                </component>
            `);
            program.validate();
            expectTypeToBe(program.globalScope.symbolTable.getSymbolType('roSGNodeWidget', { flags: SymbolTypeFlag.typetime }), ComponentType);
        });

        it('adds the fields as members to its type', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                        <field id="isAA" type="assocArray" />
                        <field id="isFloat" type="float" />
                        <field id="isNodeArray" type="nodeArray" />
                        <field id="isArray" type="array" />
                        <field id="isStringArray" type="stringarray" />
                        <field id="isIntArray" type="intarray" />
                        <field id="isUri" type="uri" />
                        <field id="isBool" type="boolean" />
                        <field id="isColor" type="color" />
                        <field id="isColorArray" type="colorarray" />
                        <field id="isVector2d" type="vector2d" />
                        <field id="isTime" type="time" />
                        <field id="isRect2d" type="rect2D" />
                        <field id="isRect2dArray" type="rect2Darray" />
                    </interface>
                </component>
            `);
            program.validate();
            const widgetType = program.globalScope.symbolTable.getSymbolType('roSGNodeWidget', { flags: SymbolTypeFlag.typetime });

            expectTypeToBe(widgetType.getMemberType('isAA', { flags: SymbolTypeFlag.runtime }), AssociativeArrayType);
            expectTypeToBe(widgetType.getMemberType('isFloat', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(widgetType.getMemberType('isNodeArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isNodeArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, ComponentType);

            expectTypeToBe(widgetType.getMemberType('isArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, DynamicType);

            expectTypeToBe(widgetType.getMemberType('isStringArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isStringArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, StringType);

            expectTypeToBe(widgetType.getMemberType('isIntArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isIntArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, IntegerType);

            expectTypeToBe(widgetType.getMemberType('isBool', { flags: SymbolTypeFlag.runtime }), BooleanType);

            expectTypeToBe(widgetType.getMemberType('isColor', { flags: SymbolTypeFlag.runtime }), UnionType);
            let colorType = widgetType.getMemberType('isColor', { flags: SymbolTypeFlag.runtime }) as UnionType;
            expect(colorType.types).to.include(StringType.instance);
            expect(colorType.types).to.include(IntegerType.instance);

            expectTypeToBe(widgetType.getMemberType('isColorArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isColorArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, UnionType);

            expectTypeToBe(widgetType.getMemberType('isVector2d', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isVector2d', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, FloatType);

            expectTypeToBe(widgetType.getMemberType('isTime', { flags: SymbolTypeFlag.runtime }), DoubleType);

            expectTypeToBe(widgetType.getMemberType('isRect2d', { flags: SymbolTypeFlag.runtime }), AssociativeArrayType);
            let rect2dtype = (widgetType.getMemberType('isRect2d', { flags: SymbolTypeFlag.runtime }) as AssociativeArrayType);
            expectTypeToBe(rect2dtype.getMemberType('height', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dtype.getMemberType('width', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dtype.getMemberType('x', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dtype.getMemberType('y', { flags: SymbolTypeFlag.runtime }), FloatType);

            expectTypeToBe(widgetType.getMemberType('isRect2dArray', { flags: SymbolTypeFlag.runtime }), ArrayType);
            expectTypeToBe((widgetType.getMemberType('isRect2dArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType, AssociativeArrayType);
            let rect2dArrayDefault = (widgetType.getMemberType('isRect2dArray', { flags: SymbolTypeFlag.runtime }) as ArrayType).defaultType as AssociativeArrayType;
            expectTypeToBe(rect2dArrayDefault.getMemberType('height', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dArrayDefault.getMemberType('width', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dArrayDefault.getMemberType('x', { flags: SymbolTypeFlag.runtime }), FloatType);
            expectTypeToBe(rect2dArrayDefault.getMemberType('y', { flags: SymbolTypeFlag.runtime }), FloatType);
        });


        it('adds function as callFunc members to its type', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', trim`
                function someFunc(input as string) as float
                    return input.toFloat()
                end function
            `);
            program.validate();
            const widgetTypeResult = program.globalScope.symbolTable.getSymbolType('roSGNodeWidget', { flags: SymbolTypeFlag.typetime });
            expectTypeToBe(widgetTypeResult, ComponentType);
            const widgetType = widgetTypeResult as ComponentType;
            // 'someFunc' isn't a regular member
            expect(widgetType.getMemberType('someFunc', { flags: SymbolTypeFlag.runtime }).isResolvable()).to.be.false;
            expectTypeToBe(widgetType.getCallFuncType('someFunc', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        });

        it('allows .callFunc() on components', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                sub someFunc(input as object)
                    print input
                end sub
            `);
            program.setFile('source/util.brs', `
                sub useCallFunc(input as roSGNodeWidget)
                    input.callFunc("someFunc", {hello: "world"})
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

    });
});
