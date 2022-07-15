import { testParse } from '../BsParserTestUtils.spec';

describe.only('stop statement', () => {
    //TODO move this to the syntax checker
    it.skip('cannot be used as a local variable', () => {
        // let { statements, diagnostics } = Parser.parse([
        //     token(TokenKind.Stop, 'stop'),
        //     token(TokenKind.Equal, '='),
        //     token(TokenKind.True, 'true'),
        //     EOF
        // ]);

        // //should be an error
        // expect(diagnostics).to.be.length.greaterThan(0);
        // expect(statements).to.exist;
        // expect(statements).not.to.be.null;
    });

    it('is valid as a statement', () => {
        testParse(`
            stop
        `, [
            ['stop']
        ]);
    });

    //TODO once AA is implemented
    it.skip('can be used as an object property', () => {
        // let { tokens } = Lexer.scan(`
        //     sub Main()
        //         theObject = {
        //             stop: false
        //         }
        //         theObject.stop = true
        //     end sub
        // `);
        // let { diagnostics } = Parser.parse(tokens);
        // expect(diagnostics.length).to.equal(0);
    });
});
