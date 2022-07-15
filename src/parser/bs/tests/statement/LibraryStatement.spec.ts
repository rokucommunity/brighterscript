import { DiagnosticMessages } from '../../../../DiagnosticMessages';
import { testParse } from '../BsParserTestUtils.spec';
const newline = `
`;
describe.only('LibraryStatement', () => {
    it('supports library statements at top of file', () => {
        testParse(`
            Library "v30/bslCore.brs"
            'some comment
        `, [
            ['Library', ' ', '"v30/bslCore.brs"'],
            newline,
            `'some comment`
        ]);
    });

    it('supports multiple library statements separated by colon', () => {
        testParse(`
            Library "v30/bslCore.brs" : Library "v30/bslCore.brs"
        `, [
            ['Library', ' ', '"v30/bslCore.brs"'],
            ' ', ':', ' ',
            ['Library', ' ', '"v30/bslCore.brs"']
        ]);
    });

    it('still parses entire file after invalid library statement', () => {
        testParse(`
            library cat dog mouse
            value = true
        `, [
            'library',
            DiagnosticMessages.expectedStringLiteralAfterKeyword('library'), ' ',
            'cat',
            DiagnosticMessages.unexpectedToken('cat'), ' ',
            'dog',
            DiagnosticMessages.unexpectedToken('dog'), ' ',
            'mouse',
            DiagnosticMessages.unexpectedToken('mouse'),
            newline,
            ['value', ' ', '=', ' ', ['true']]
        ]);
    });

    it('allows usage of `library` as varible name', () => {
        testParse(`
            library = "Gotham City Library"
        `, [
            ['library', ' ', '=', ' ', ['"Gotham City Library"']]
        ]);
    });

    it.skip('does not prevent usage of `library` as object property name', () => {
        testParse(`
            buildings = {
                library: "Gotham City Library"
            }
            print buildings.library
        `, [
            'TODO'
        ]);
    });

    it('parses rest of file with ONLY the library keyword present at root level', () => {
        testParse(`
            library
            library = "Your Library"
        `, [
            'library',
            DiagnosticMessages.expectedStringLiteralAfterKeyword('library'),
            newline,
            ['library', ' ', '=', ' ', ['"Your Library"']]
        ]);
    });
});
