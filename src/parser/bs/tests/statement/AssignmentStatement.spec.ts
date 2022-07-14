import { testParse } from '../BsParserTestUtils.spec';

describe.only('AssignmentStatement', () => {
    it('works for literals', () => {
        testParse(`
            name = 1
        `, [
            ['name', ' ', '=', ' ', ['1']]
        ]);
        testParse(`
            name="hello world"
        `, [
            ['name', '=', ['"hello world"']]
        ]);
    });
});
