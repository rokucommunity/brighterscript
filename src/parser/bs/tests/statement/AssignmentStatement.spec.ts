import { testParse } from '../BsParserTestUtils.spec';

describe('AssignmentStatement', () => {
    it('works with multiple spaces', () => {
        testParse(`
            name    =    1
        `, [
            ['name', '    ', '=', '    ', ['1']]
        ]);
    });

    it('works with no spaces', () => {
        testParse(`
            name="hello world"
        `, [
            ['name', '=', ['"hello world"']]
        ]);
    });

    describe('assignment operators', () => {
        it('=', () => {
            testParse(`
                value = 1
            `, [
                ['value', ' ', '=', ' ', ['1']]
            ]);
        });

        it('+=', () => {
            testParse(`
                value += 1
            `, [
                ['value', ' ', '+=', ' ', ['1']]
            ]);
        });

        it('-=', () => {
            testParse(`
                value -= 1
            `, [
                ['value', ' ', '-=', ' ', ['1']]
            ]);
        });

        it('*=', () => {
            testParse(`
                value *= 1
            `, [
                ['value', ' ', '*=', ' ', ['1']]
            ]);
        });

        it('/=', () => {
            testParse(`
                value /= 1
            `, [
                ['value', ' ', '/=', ' ', ['1']]
            ]);
        });

        it('\\=', () => {
            testParse(`
                value \\= 1
            `, [
                ['value', ' ', '\\=', ' ', ['1']]
            ]);
        });

        it('<<=', () => {
            testParse(`
                value <<= 1
            `, [
                ['value', ' ', '<<=', ' ', ['1']]
            ]);
        });

        it('>>=', () => {
            testParse(`
                value >>= 1
            `, [
                ['value', ' ', '>>=', ' ', ['1']]
            ]);
        });
    });
});
