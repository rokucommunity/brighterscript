import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { expectDiagnostics } from '../../testHelpers.spec';
import { standardizePath as s, util } from '../../util';
const rootDir = s`${process.cwd()}/.tmp/rootDir`;

describe('BrsFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('enums', () => {
        it('flags duplicate members', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    name
                    name
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateIdentifier('name'),
                range: util.createRange(3, 20, 3, 24)
            }]);
        });

        it('flags mismatched enum value types', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    a = 1
                    b = "c"
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueMustBeType('integer'),
                range: util.createRange(3, 24, 3, 27)
            }]);
        });

        it('flags mismatched enum value types', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    a = "a"
                    b = 1
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueMustBeType('string'),
                range: util.createRange(3, 24, 3, 25)
            }]);
        });

        it('flags missing value for string enum', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    a = "a"
                    b
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueIsRequired('string'),
                range: util.createRange(3, 20, 3, 21)
            }]);
        });

        it('flags missing value for string enum', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    a
                    b = "b" 'since this is the only value present, this is a string enum
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueIsRequired('string'),
                range: util.createRange(2, 20, 2, 21)
            }]);
        });
    });
});
