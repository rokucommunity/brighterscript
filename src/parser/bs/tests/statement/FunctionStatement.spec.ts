import { BsParser, Node } from '../../BsParser';
import { testParse } from '../BsParserTestUtils.spec';

describe('FunctionStatement', () => {
    beforeEach(() => { });

    it('parses basic function declarations', () => {
        testParse(`
            function foo()
            end function
        `, new Node('body', []));

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.length.greaterThan(0);

    });
});
