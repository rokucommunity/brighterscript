import { expect } from '../chai-config.spec';
import { ArrayType } from './ArrayType';
import { AssociativeArrayType } from './AssociativeArrayType';
import { BooleanType } from './BooleanType';
import { ClassType } from './ClassType';
import { ComponentType } from './ComponentType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { EnumMemberType, EnumType } from './EnumType';
import { FloatType } from './FloatType';
import { FunctionType } from './FunctionType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { IntersectionType } from './IntersectionType';
import { InvalidType } from './InvalidType';
import { LongIntegerType } from './LongIntegerType';
import { NeverType } from './NeverType';
import { ObjectType } from './ObjectType';
import { ReferenceType } from './ReferenceType';
import { StringType } from './StringType';
import { TypedFunctionType } from './TypedFunctionType';
import { UnionType } from './UnionType';
import { VoidType } from './VoidType';
import { roFunctionType } from './roFunctionType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { SymbolTable } from '../SymbolTable';

describe('NeverType', () => {
    it('is equal only to never', () => {
        expect(NeverType.instance.isEqual(NeverType.instance)).to.be.true;
        expect(NeverType.instance.isEqual(DynamicType.instance)).to.be.false;
        expect(NeverType.instance.isEqual(VoidType.instance)).to.be.false;
        expect(NeverType.instance.isEqual(InvalidType.instance)).to.be.false;
    });

    it('is assignable to every type', () => {
        const types = [
            new ArrayType(StringType.instance),
            new AssociativeArrayType(),
            BooleanType.instance,
            new ClassType('Klass'),
            new ComponentType('Node'),
            DoubleType.instance,
            DynamicType.instance,
            new EnumType('Direction', StringType.instance),
            new EnumMemberType('Direction', 'up', StringType.instance),
            FloatType.instance,
            new FunctionType(),
            IntegerType.instance,
            new InterfaceType('Iface'),
            new IntersectionType([new InterfaceType('A'), new InterfaceType('B')]),
            InvalidType.instance,
            LongIntegerType.instance,
            NeverType.instance,
            new ObjectType(),
            new ReferenceType('Unknown', 'Unknown', SymbolTypeFlag.typetime, () => new SymbolTable('test')),
            StringType.instance,
            new TypedFunctionType(StringType.instance),
            new UnionType([StringType.instance, IntegerType.instance]),
            VoidType.instance,
            new roFunctionType()
        ];
        for (const type of types) {
            expect(type.isTypeCompatible(NeverType.instance), `never should be assignable to ${type.toString()}`).to.be.true;
        }
    });

    it('accepts no type except never', () => {
        const types = [
            BooleanType.instance,
            new ClassType('Klass'),
            DynamicType.instance,
            IntegerType.instance,
            InvalidType.instance,
            new ObjectType(),
            StringType.instance,
            new UnionType([StringType.instance, IntegerType.instance]),
            VoidType.instance
        ];
        for (const type of types) {
            expect(NeverType.instance.isTypeCompatible(type), `${type.toString()} should not be assignable to never`).to.be.false;
        }
        expect(NeverType.instance.isTypeCompatible(NeverType.instance)).to.be.true;
    });

    it('prints as never', () => {
        expect(NeverType.instance.toString()).to.eql('never');
        expect(NeverType.instance.toTypeString()).to.eql('never');
    });

    it('has never members and returns never when called', () => {
        expect(NeverType.instance.getMemberType('anything', { flags: SymbolTypeFlag.runtime })).to.equal(NeverType.instance);
        expect(NeverType.instance.getCallFuncType('anything', { flags: SymbolTypeFlag.runtime })).to.equal(NeverType.instance);
        expect(NeverType.instance.returnType).to.equal(NeverType.instance);
    });
});
