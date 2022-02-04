import { expect } from 'chai';

import { ArrayType } from './ArrayType';
import { DynamicType } from './DynamicType';
import { BooleanType } from './BooleanType';
import { StringType } from './StringType';
import { CustomType } from './CustomType';
import { IntegerType } from './IntegerType';
import { FloatType } from './FloatType';
import { Program } from '../Program';
import type { TypeContext } from './BscType';
import { Position } from 'vscode-languageserver-protocol';
import type { BrsFile } from '../files/BrsFile';

describe('ArrayType', () => {
    it('is equivalent to array types', () => {
        expect(new ArrayType().isAssignableTo(new ArrayType())).to.be.true;
        expect(new ArrayType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it('catches arrays containing different inner types', () => {
        expect(new ArrayType(new BooleanType()).isAssignableTo(new ArrayType(new BooleanType()))).to.be.true;
        expect(new ArrayType(new BooleanType()).isAssignableTo(new ArrayType(new StringType()))).to.be.false;
    });

    it('sets the innerTypes to unique types', () => {
        const boolArray = new ArrayType(new BooleanType(), new BooleanType());
        expect(boolArray.innerTypes.length).to.eql(1);
        expect(boolArray.innerTypes[0].equals(new BooleanType())).to.be.true;
        expect(boolArray.toJsString()).to.eql('Array<boolean>');

        const multiTypeArray = new ArrayType(new BooleanType(), new StringType(), new BooleanType());
        expect(multiTypeArray.innerTypes.length).to.eql(2);
        expect(multiTypeArray.innerTypes[0].equals(new BooleanType())).to.be.true;
        expect(multiTypeArray.innerTypes[1].equals(new StringType())).to.be.true;
        expect(multiTypeArray.toJsString()).to.eql('Array<boolean | string>');
    });

    it('sets the innerTypes to custom types', () => {
        expect(new ArrayType(new CustomType('MyKlass')).toString()).to.eql('MyKlass[]');
    });

    it('is not equivalent to other types', () => {
        expect(new ArrayType().isAssignableTo(new BooleanType())).to.be.false;
    });

    describe('isConvertibleTo', () => {
        expect(new ArrayType().isConvertibleTo(new BooleanType())).to.be.false;
        expect(new ArrayType().isConvertibleTo(new ArrayType())).to.be.true;
    });

    describe('toString', () => {
        it('returns the default type', () => {
            expect(new ArrayType(new BooleanType()).toString()).to.eql('boolean[]');
            expect(new ArrayType(new StringType()).toString()).to.eql('string[]');
            expect(new ArrayType(new CustomType('MyKlass')).toString()).to.eql('MyKlass[]');
        });

        it('returns dynamic if more than one type is assigned', () => {
            expect(new ArrayType(new BooleanType(), new StringType()).toString()).to.eql('dynamic[]');
        });
    });

    describe('unique types by assignability', () => {
        it('follows the isAssignable method on the type', () => {
            const numbersArray = new ArrayType(new IntegerType(), new FloatType(), new IntegerType(), new FloatType());
            // integers ARE NOT assignable to float, and vice versa
            expect(numbersArray.innerTypes.length).to.eql(2);
            expect(numbersArray.innerTypes[0].equals(new IntegerType())).to.be.true;
            expect(numbersArray.innerTypes[1].equals(new FloatType())).to.be.true;
        });

        it('sets the default type to Dynamic if types are not assignable', () => {
            const numbersArray = new ArrayType(new IntegerType(), new FloatType(), new IntegerType(), new FloatType());
            // integers ARE NOT assignable to float, and vice versa
            expect(numbersArray.getDefaultType().equals(new DynamicType())).to.be.true;
        });

        it('sets the default type to the most general of the types provided', () => {
            const program = new Program({
                rootDir: process.cwd()
            });
            program.createSourceScope();
            const file: BrsFile = program.setFile('source/main.bs', `
                class Parent
                end class

                class Child extends Parent
                end class

                sub main()
                    ' inside main
                end sub
            `);
            const klassesArray = new ArrayType(new CustomType('Child'), new CustomType('Parent'), new CustomType('Child'));
            const context: TypeContext = { scope: program.getScopesForFile(file)[0], file: file, position: Position.create(8, 23) };
            expect(klassesArray.innerTypes.length).to.eql(2);
            expect(klassesArray.getDefaultType(context).equals(new CustomType('Parent'))).to.be.true;
        });
    });
});
