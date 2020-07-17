import { expect } from 'chai';
import { DynamicType } from './DynamicType';
import { Program } from '../Program';
import { standardizePath as s } from '../util';
import { BooleanType } from './BooleanType';

let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;

describe('BooleanType', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    afterEach(() => {
        program.dispose();
    });

    it('is equivalent to boolean types', () => {
        expect(new BooleanType().isAssignableTo(new BooleanType())).to.be.true;
        expect(new BooleanType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it.only('flags errors in the program when calling unknown function on boolean', async () => {
        await program.addOrReplaceFile('source/main.brs', `
            sub main()
                boolValue = true
                boolValue.ToStr() ' this is valid
                boolValue.UnknownFunction() 'this should be an error
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.eql('Unknown function');
    });
});
