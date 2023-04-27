import { expect } from 'chai';
import { ClassType } from './ClassType';
import { StringType } from './StringType';
import { SymbolTable, SymbolTypeFlags } from '../SymbolTable';
import { expectTypeToBe } from '../testHelpers.spec';
import { ReferenceType } from './ReferenceType';
import { isReferenceType } from '../astUtils/reflection';
import { IntegerType } from './IntegerType';

describe('ClassType', () => {

    it('can have a super class', () => {
        const superKlass = new ClassType('SuperKlass');
        const subKlass = new ClassType('SubKlass', superKlass);

        expect(subKlass.superClass).to.exist;
        expect(subKlass.superClass.toString()).to.equal('SuperKlass');
    });

    it('should be assignable to a super klass, or higher ancestor', () => {
        const grandSuperKlass = new ClassType('GrandSuperKlass');
        const superKlass = new ClassType('SuperKlass', grandSuperKlass);
        const subKlass = new ClassType('SubKlass', superKlass);

        expect(subKlass.isAssignableTo(subKlass)).to.be.true;
        expect(subKlass.isAssignableTo(superKlass)).to.be.true;
        expect(subKlass.isAssignableTo(grandSuperKlass)).to.be.true;
    });

    it('should not be assignable to a class that is not an ancestor', () => {
        const otherKlass = new ClassType('OtherKlass');

        const superKlass = new ClassType('SuperKlass');
        const subKlass = new ClassType('SubKlass', superKlass);

        expect(subKlass.isAssignableTo(superKlass)).to.be.true;
        expect(subKlass.isAssignableTo(otherKlass)).to.be.false;
    });

    it('will look in super classes for members', () => {
        const superKlass = new ClassType('SuperKlass');
        superKlass.addMember('title', null, StringType.instance, SymbolTypeFlags.runtime);
        const subKlass = new ClassType('SubKlass', superKlass);
        expectTypeToBe(subKlass.getMemberType('title', SymbolTypeFlags.runtime), StringType);
    });

    it('allow ReferenceTypes as super classes', () => {
        const myTable = new SymbolTable('test');
        const futureSuperKlass = new ReferenceType('SuperKlass', SymbolTypeFlags.typetime, () => myTable);
        const subKlass = new ClassType('SubKlass', futureSuperKlass);
        expect(subKlass.isResolvable()).to.be.false;
        const superKlass = new ClassType('SuperKlass');
        myTable.addSymbol('SuperKlass', null, superKlass, SymbolTypeFlags.typetime);
        expect(subKlass.isResolvable()).to.be.true;
    });

    it('allows members of future super classes to be resolved', () => {
        const myTable = new SymbolTable('test');
        const futureSuperKlass = new ReferenceType('SuperKlass', SymbolTypeFlags.typetime, () => myTable);
        const subKlass = new ClassType('SubKlass', futureSuperKlass);
        expect(subKlass.isResolvable()).to.be.false;
        const futureTitleType = subKlass.getMemberType('title', SymbolTypeFlags.runtime);
        expect(isReferenceType(futureTitleType)).to.be.true;
        expect(futureTitleType.isResolvable()).to.be.false;
        const superKlass = new ClassType('SuperKlass');
        superKlass.addMember('title', null, StringType.instance, SymbolTypeFlags.runtime);
        // eslint-disable-next-line no-bitwise
        myTable.addSymbol('SuperKlass', null, superKlass, SymbolTypeFlags.typetime | SymbolTypeFlags.runtime);
        expect(futureTitleType.isResolvable()).to.be.true;
        expectTypeToBe(futureTitleType, StringType);
    });

    describe('toJSString', () => {
        it('includes superclass members', () => {
            const superKlass = new ClassType('SuperKlass');
            const subKlass = new ClassType('SubKlass', superKlass);
            superKlass.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
            superKlass.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

            expect(subKlass.toJSString).to.exist;
            expect(subKlass.toJSString()).to.equal('{ age: integer; name: string; }');
        });
    });

});
