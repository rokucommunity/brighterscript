import { createSandbox } from 'sinon';
import { expect } from '../chai-config.spec';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { expectTypeToBe } from '../testHelpers.spec';
import { ComponentType } from './ComponentType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { StringType } from './StringType';
import { TypedFunctionType } from './TypedFunctionType';
import { TypeStatementType } from './TypeStatementType';

const sinon = createSandbox();

describe('TypeStatementType', () => {
    afterEach(() => {
        sinon.restore();
    });

    it('stringifies as the alias name, but transpiles as the wrapped type', () => {
        const alias = new TypeStatementType('MyNumber', IntegerType.instance);

        expect(alias.toString()).to.eql('MyNumber');
        expect(alias.toTypeString()).to.eql('integer');
    });

    it('delegates compatibility to the wrapped type', () => {
        const alias = new TypeStatementType('MyNumber', IntegerType.instance);

        expect(alias.isTypeCompatible(IntegerType.instance)).to.be.true;
        expect(alias.isTypeCompatible(StringType.instance)).to.be.false;
    });

    it('reports the alias as the expectedType when compatibility fails', () => {
        const iface = new InterfaceType('Thing');
        iface.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const wrapped = new TypeStatementType('MyThing', iface);

        const data = {} as any;
        wrapped.isTypeCompatible(IntegerType.instance, data);
        //the alias substitutes itself so diagnostics name `MyThing` rather than the underlying interface
        expect(data.expectedType).to.equal(wrapped);
    });

    it('keeps a caller-supplied expectedType', () => {
        const alias = new TypeStatementType('MyNumber', IntegerType.instance);
        const data = { expectedType: StringType.instance } as any;

        alias.isTypeCompatible(StringType.instance, data);

        expect(data.expectedType).to.equal(StringType.instance);
    });

    it('delegates isEqual to the wrapped type', () => {
        const alias = new TypeStatementType('MyNumber', IntegerType.instance);

        expect(alias.isEqual(IntegerType.instance)).to.be.true;
        expect(alias.isEqual(StringType.instance)).to.be.false;
    });

    it('delegates member lookups to the wrapped type', () => {
        const iface = new InterfaceType('Thing');
        iface.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const alias = new TypeStatementType('MyThing', iface);

        expectTypeToBe(
            alias.getMemberType('name', { flags: SymbolTypeFlag.runtime }),
            StringType
        );
        expect(alias.getMemberTable()).to.equal(iface.getMemberTable());
    });

    it('exposes the return type when wrapping a callable', () => {
        const func = new TypedFunctionType(IntegerType.instance);
        const alias = new TypeStatementType('MyFunc', func);

        expectTypeToBe(alias.returnType, IntegerType);
    });

    it('has no return type when wrapping a non-callable', () => {
        const alias = new TypeStatementType('MyNumber', IntegerType.instance);

        expect(alias.returnType).to.be.undefined;
    });

    it('only forwards addBuiltInInterfaces to the wrapped type once', () => {
        const iface = new InterfaceType('Thing');
        iface.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const alias = new TypeStatementType('MyThing', iface);
        const spy = sinon.spy(iface, 'addBuiltInInterfaces');

        alias.addBuiltInInterfaces();
        alias.addBuiltInInterfaces();

        expect(spy.callCount).to.eql(1);
    });

    it('delegates callFunc lookups to the wrapped type', () => {
        const component = new ComponentType('Widget');
        component.addCallFuncMember('refresh', null, new TypedFunctionType(IntegerType.instance), SymbolTypeFlag.runtime);
        const alias = new TypeStatementType('MyWidget', component);

        expect(alias.getCallFuncTable()).to.equal(component.getCallFuncTable());
        expectTypeToBe(
            alias.getCallFuncType('refresh', { flags: SymbolTypeFlag.runtime }),
            TypedFunctionType
        );
    });
});
