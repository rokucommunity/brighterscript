import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Parser } from '../../Parser';
import { TryCatchStatement } from '../../Statement';

describe('parser try/catch', () => {
    it('can parse try catch statements', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                catch e
                    print "error"
                end try
            end sub
        `);
        expect(parser.diagnostics[0]?.message).not.to.exist;
        const stmt = parser.references.functionExpressions[0].body.statements[0] as TryCatchStatement;
        expect(stmt).to.be.instanceof(TryCatchStatement);
        expect(stmt.tryToken?.text).to.eql('try');
        expect(stmt.tryBranch).to.exist.and.ownProperty('statements').to.be.lengthOf(1);
        expect(stmt.catchToken?.text).to.eql('catch');
        expect(stmt.exceptionVariable.name.text).to.eql('e');
        expect(stmt.catchBranch).to.exist.and.ownProperty('statements').to.be.lengthOf(1);
        expect(stmt.endTryToken?.text).to.eql('end try');
    });

    it('supports various configurations of try-catch', () => {
        function expectNoParseErrors(text: string) {
            const parser = Parser.parse(`
                sub main()
                    ${text}
                end sub
            `);
            expect(parser.diagnostics[0]?.message).not.to.exist;
        }

        expectNoParseErrors(`
            try : print a.b.c : catch e : print "error" :  end try
        `);

        //multiple statements
        expectNoParseErrors(`
            try : print "one" : print "two" : catch e : print "error" : end try
        `);

        expectNoParseErrors(`
            try : print a.b.c
            catch e : print "error" :  end try
        `);

        expectNoParseErrors(`
            try
                print a.b.c
            catch e : print "error" :  end try
        `);

        expectNoParseErrors(`
            try
                print a.b.c
            catch e
                print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c
            catch e
                print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c :  catch e
            print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c :  catch e : print "error"
            end try
        `);

        expectNoParseErrors(`
            try
            : print a.b.c : catch e : print "error" : end try
        `);

        // expectNoParseErrors(`
        //     try : print a.b.c
        //     : catch e : print "error" : end try
        // `);

        // expectNoParseErrors(`
        //     try : print a.b.c
        //     : catch e
        //     : print "error" : end try
        // `);

        // expectNoParseErrors(`
        //     try
        //     : print a.b.c
        //     : catch e
        //     : print "error"
        //     : end try
        // `);
    });

    it('recovers gracefully with syntax errors', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                catch e
                    print "error"
                end try
            end sub
        `);
        expect(parser.diagnostics[0]?.message).not.to.exist;
    });
});
