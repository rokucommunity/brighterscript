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
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateIdentifier('name'),
                range: util.createRange(3, 20, 3, 24)
            }]);
        });

        it.skip('flags mismatched enum value types', () => {
            program.addOrReplaceFile('source/main.bs', `
                enum Direction
                    a = 1
                    b = "c"
                end enum
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumMembersMustHaveSameType('integer'),
                range: util.createRange(3, 20, 3, 24)
            }]);
        });
    });
});
