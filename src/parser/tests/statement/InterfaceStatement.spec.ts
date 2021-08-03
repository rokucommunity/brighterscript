import { getTestGetTypedef } from '../../../testHelpers.spec';
import { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';

describe('InterfaceStatement', () => {
    const rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    const testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    it('allows strange keywords as property names', () => {
        testGetTypedef(`
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

    it('allows strange keywords as method names', () => {
        testGetTypedef(`
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

    it('includes comments', () => {
        testGetTypedef(`
            interface Person
                'some comment
                sub someFunc() as string
            end interface
        `, undefined, undefined, undefined, true);
    });

    it('includes annotations', () => {
        testGetTypedef(`
            @IFace
            interface Person
                @Method
                sub someFunc() as string
                @Field
                someField as string
            end interface
        `, undefined, undefined, undefined, true);
    });
});
