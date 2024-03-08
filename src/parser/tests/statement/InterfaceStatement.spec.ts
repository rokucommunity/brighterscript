import { expectZeroDiagnostics, getTestGetTypedef, getTestTranspile } from '../../../testHelpers.spec';
import { rootDir } from '../../../testHelpers.spec';
import { Program } from '../../../Program';

describe('InterfaceStatement', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);
    const testGetTypedef = getTestGetTypedef(() => [program, rootDir]);
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('allows strange keywords as property names', async () => {
        await testGetTypedef(`
            interface Person
                public as string
                protected as string
                private as string
                sub as string
                function as string
                interface as string
                endInterface as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('allows strange keywords as method names', async () => {
        await testGetTypedef(`
            interface Person
                sub public() as string
                sub protected() as string
                sub private() as string
                sub sub() as string
                sub function() as string
                sub interface() as string
                sub endInterface() as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes comments', async () => {
        await testGetTypedef(`
            interface Person
                'some comment
                sub someFunc() as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes annotations', async () => {
        await testGetTypedef(`
            @IFace
            interface Person
                @Method
                sub someFunc() as string
                @Field
                someField as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('allows declaring multiple interfaces in a file', () => {
        program.setFile('source/interfaces.bs', `
            interface Iface1
                name as dynamic
            end interface
            interface IFace2
                prop as dynamic
            end interface
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('allows comments after an interface', async () => {
        await testTranspile(`
            interface Iface1
                name as dynamic
            end interface
            'this comment was throwing exception during transpile
            interface IFace2
                prop as dynamic
            end interface
        `, `
            'this comment was throwing exception during transpile
        `);
    });

    it('allows parameters in interface method signatures', async () => {
        await testGetTypedef(`
            interface Person
                sub someFunc(name as string, age as integer) as string
                someField as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes "optional" modifier in typedef', async () => {
        await testGetTypedef(`
            interface Person
                name as string
                optional age as integer
            end interface
        `);
    });

    it('supports empty interfaces', () => {
        const file = program.setFile('source/main.bs', `
           interface SomeInterface
           end interface
        `);
        program.validate();
        expectZeroDiagnostics(file);
    });
});
