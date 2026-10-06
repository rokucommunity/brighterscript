import { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import { expectDiagnostics, expectZeroDiagnostics } from './testHelpers.spec';
import util, { standardizePath as s } from './util';
import { expect } from './chai-config.spec';
import { createSandbox } from 'sinon';
import { TokenKind } from './lexer/TokenKind';
import { createToken } from './astUtils/creators';


describe('DiagnosticManager', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({});
    });

    describe('diagnosticIsSuppressed', () => {
        it('does not crash when diagnostic is missing location information', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test. range must be missing
                location: { uri: util.pathToUri(file?.srcPath), range: undefined }
            };

            file.commentFlags.push({
                affectedRange: util.createRange(1, 2, 3, 4),
                codes: [1, 2, 3],
                file: file,
                range: util.createRange(1, 2, 3, 4)
            });
            program.diagnostics.register(diagnostic);

            program.diagnostics.isDiagnosticSuppressed(diagnostic);

            //test passes if there's no crash
        });

        it('does not crash when diagnostic is missing the entire `.location` object', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test, `.uri` must be missing
                location: { uri: undefined, range: util.createRange(1, 2, 3, 4) }
            };

            file.commentFlags.push({
                affectedRange: util.createRange(1, 2, 3, 4),
                codes: [1, 2, 3],
                file: file,
                range: util.createRange(1, 2, 3, 4)
            });
            program.diagnostics.register(diagnostic);

            program.diagnostics.isDiagnosticSuppressed(diagnostic);

            //test passes if there's no crash
        });
    });

    describe('clearForFile', () => {
        it('does not crash when filePath is invalid', () => {
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test. `.uri` must be missing
                location: { uri: undefined, range: util.createRange(1, 2, 3, 4) }
            };

            program.diagnostics.register(diagnostic);

            program.diagnostics.clearForFile(undefined);
            program.diagnostics.clearForFile(null);
            program.diagnostics.clearForFile('');
            //the test passes because none of these lines throw an error
        });

        it('removes diagnostics from the file specified', () => {
            program.diagnostics.register([
                {
                    message: 'test',
                    location: { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) }
                },
                {
                    message: 'test2',
                    location: { uri: 'source/main2.brs', range: util.createRange(1, 2, 3, 4) }
                }
            ]);

            program.diagnostics.clearForFile('source/main.brs');
            expectDiagnostics(program.getDiagnostics(), [
                { message: 'test2' }
            ]);
        });
    });

    describe('clearForScope', () => {

        it('removes diagnostic contexts with the scope specified', () => {
            const scope1 = new Scope('scope1', program);
            const scope2 = new Scope('scope2', program);
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };

            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location },
                    context: { scope: scope1 }
                },
                {
                    diagnostic: { message: 'test', location: location },
                    context: { scope: scope2 }
                }
            ]);

            program.diagnostics.clearForScope(scope1);
            expectDiagnostics(program.getDiagnostics(), [
                { message: 'test', relatedInformation: [{ message: `In scope 'scope2'` }] }
            ]);
        });

        it('removes diagnostics with when all contexts are removed', () => {
            const scope1 = new Scope('scope1', program);
            const scope2 = new Scope('scope2', program);
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location },
                    context: { scope: scope1 }
                },
                {
                    diagnostic: { message: 'test', location: location },
                    context: { scope: scope2 }
                }
            ]);

            program.diagnostics.clearForScope(scope1);
            program.diagnostics.clearForScope(scope2);
            expectZeroDiagnostics(program.getDiagnostics());
        });

    });

    describe('clearTag', () => {
        it('removes diagnostic contexts with the tag specified', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const location2 = { uri: 'source/main2.brs', range: util.createRange(1, 2, 3, 4) };

            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location },
                    context: { tags: ['testTag'] }
                },
                {
                    diagnostic: { message: 'test2', location: location },
                    context: { tags: ['testTag'] }
                },

                {
                    diagnostic: { message: 'test2', location: location2 },
                    context: { tags: ['testTag'] }
                },
                {
                    diagnostic: { message: 'test3', location: location },
                    context: { tags: ['otherTag', 'testTag'] }
                }
            ]);

            program.diagnostics.clearForTag('testTag');
            expectZeroDiagnostics(program.getDiagnostics());
        });

        it('removes diagnostic contexts with the tag specified', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const location2 = { uri: 'source/main2.brs', range: util.createRange(1, 2, 3, 4) };

            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location },
                    context: { tags: ['testTag'] }
                },
                {
                    diagnostic: { message: 'test2', location: location },
                    context: { tags: ['testTag'] }
                },

                {
                    diagnostic: { message: 'test2', location: location2 },
                    context: { tags: ['testTag'] }
                },
                {
                    diagnostic: { message: 'test3', location: location },
                    context: { tags: ['otherTag', 'testTag'] }
                }
            ]);

            program.diagnostics.clearForTag('testTag');
            expectZeroDiagnostics(program.getDiagnostics());
        });
    });

    describe('clearByFilter', () => {

        it('removes diagnostics that match the filter', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const location2 = { uri: 'source/main2.brs', range: util.createRange(1, 2, 3, 4) };

            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location, code: 1 },
                    context: { tags: ['tag1'] }
                },
                {
                    diagnostic: { message: 'test2', location: location, code: 2 },
                    context: { tags: ['tag2'] }
                },
                {
                    diagnostic: { message: 'test2', location: location2, code: 3 },
                    context: { tags: ['tag1'] }
                },
                {
                    diagnostic: { message: 'test3', location: location, code: 4 },
                    context: { tags: ['tag1'] }
                }
            ]);

            program.diagnostics.clearByFilter({ fileUri: location.uri, tag: 'tag1' });
            expectDiagnostics(program.getDiagnostics(), [
                { code: 2 }, //different tag
                { code: 3 } // different uri
            ]);
        });

        it('removes diagnostics when all contexts are removed', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const scope1 = new Scope('scope1', program);
            program.diagnostics.register([
                {
                    diagnostic: { message: 'test', location: location, code: 1 },
                    context: { tags: ['tag1'] }
                },
                {
                    diagnostic: { message: 'test', location: location, code: 1 },
                    context: { scope: scope1 }
                }
            ]);

            expect(program.getDiagnostics().length).to.eq(1); // one diagnostic with two contexts

            program.diagnostics.clearByFilter({ tag: 'tag1' });
            expectDiagnostics(program.getDiagnostics(), [
                { code: 1 } // still one context left
            ]);
            program.diagnostics.clearByFilter({ scope: scope1 });
            expectZeroDiagnostics(program.getDiagnostics());
        });

        it('only removes diagnostics that match every specified filter aspect', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const scope1 = new Scope('scope1', program);
            const scope2 = new Scope('scope2', program);

            program.diagnostics.register([
                {
                    //matches tag + scope + fileUri
                    diagnostic: { message: 'test', location: location, code: 1 },
                    context: { tags: ['tag1'], scope: scope1 }
                },
                {
                    //right tag and fileUri, wrong scope
                    diagnostic: { message: 'test', location: location, code: 2 },
                    context: { tags: ['tag1'], scope: scope2 }
                },
                {
                    //right tag and scope, wrong fileUri
                    diagnostic: { message: 'test', location: { uri: 'source/other.brs', range: location.range }, code: 3 },
                    context: { tags: ['tag1'], scope: scope1 }
                }
            ]);

            program.diagnostics.clearByFilter({ tag: 'tag1', scope: scope1, fileUri: location.uri });
            expectDiagnostics(program.getDiagnostics(), [
                { code: 2 },
                { code: 3 }
            ]);
        });

        it('clears by segment', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const segment1 = {} as any;
            const segment2 = {} as any;

            program.diagnostics.register([
                { diagnostic: { message: 'test', location: location, code: 1 }, context: { segment: segment1 } },
                { diagnostic: { message: 'test', location: location, code: 2 }, context: { segment: segment2 } }
            ]);

            program.diagnostics.clearByFilter({ segment: segment1 });
            expectDiagnostics(program.getDiagnostics(), [
                { code: 2 }
            ]);
        });

        it('does nothing when the filter matches no known tag, scope, fileUri, or segment', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            program.diagnostics.register([{
                diagnostic: { message: 'test', location: location, code: 1 },
                context: { tags: ['tag1'] }
            }]);

            program.diagnostics.clearByFilter({ tag: 'unregisteredTag' });
            program.diagnostics.clearByFilter({ fileUri: 'source/doesNotExist.brs' });
            expectDiagnostics(program.getDiagnostics(), [
                { code: 1 }
            ]);
        });

        it('clears everything when no filter aspect is specified', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            program.diagnostics.register([
                { diagnostic: { message: 'test', location: location, code: 1 }, context: { tags: ['tag1'] } },
                { diagnostic: { message: 'test', location: location, code: 2 }, context: { tags: ['tag2'] } }
            ]);

            program.diagnostics.clearByFilter({});
            expectZeroDiagnostics(program.getDiagnostics());
        });
    });

    describe('register', () => {
        it('merges relatedInformation when the same diagnostic is registered more than once', () => {
            const location = { uri: 'source/main.brs', range: util.createRange(1, 2, 3, 4) };
            const related1 = { message: 'related1', location: { uri: 'source/a.brs', range: util.createRange(1, 1, 1, 1) } };
            const related2 = { message: 'related2', location: { uri: 'source/b.brs', range: util.createRange(2, 2, 2, 2) } };
            program.diagnostics.register({ message: 'test', location: location, relatedInformation: [related1] });
            program.diagnostics.register({ message: 'test', location: location, relatedInformation: [related1, related2] });

            const diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].relatedInformation).to.eql([related1, related2]);
        });
    });

    describe('locatables', () => {
        const sinon = createSandbox();
        afterEach(() => {
            sinon.restore();
        });

        function getTokens(code: string) {
            const file = program.setFile('source/main.brs', code) as BrsFile;
            return { file: file, tokens: file.parser.tokens };
        }

        it('resolves a locatable location in getDiagnostics', () => {
            const { tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            program.diagnostics.register({ message: 'test', location: printToken });
            expectDiagnostics(program.getDiagnostics(), [
                { message: 'test', location: util.getLocation(printToken) }
            ]);
        });

        it('resolves locatable related information in getDiagnostics', () => {
            const { tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            const subToken = tokens.find(x => x.kind === TokenKind.Sub);
            program.diagnostics.register({
                message: 'test',
                location: printToken,
                relatedInformation: [{ message: 'related', location: subToken }]
            });
            const diagnostics = program.getDiagnostics();
            expect(diagnostics[0].relatedInformation).to.eql([
                { message: 'related', location: util.getLocation(subToken) }
            ]);
        });

        it('resolves a token ending in a newline to the same location as util.getLocation', () => {
            const { tokens } = getTokens('sub main()\r\n    print "hello"\nend sub\n');
            const newlineTokens = tokens.filter(x => x.kind === TokenKind.Newline);
            program.diagnostics.register(newlineTokens.map((token, i) => ({ message: `test${i}`, location: token })));
            expectDiagnostics(program.getDiagnostics(), newlineTokens.map((token, i) => ({
                message: `test${i}`,
                location: util.getLocation(token)
            })));
        });

        it('does not retain the locatable itself', () => {
            const { tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            const subToken = tokens.find(x => x.kind === TokenKind.Sub);
            program.diagnostics.register({
                message: 'test',
                location: printToken,
                relatedInformation: [{ message: 'related', location: subToken }]
            });
            const cached = [...program.diagnostics['diagnosticsCache'].values()][0].diagnostic;
            expect(cached.location).not.to.equal(printToken);
            expect(cached.location).to.eql({ pos: printToken.pos, end: printToken.end, source: printToken.source });
            expect(cached.relatedInformation[0].location).not.to.equal(subToken);
            expect(cached.relatedInformation[0].location).to.eql({ pos: subToken.pos, end: subToken.end, source: subToken.source });
        });

        it('only computes Locations during getDiagnostics', () => {
            const { file, tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            const subToken = tokens.find(x => x.kind === TokenKind.Sub);
            const scope = new Scope('scope1', program);
            const getLocationSpy = sinon.spy(util, 'getLocation');

            program.diagnostics.register({
                message: 'test',
                location: printToken,
                relatedInformation: [{ message: 'related', location: subToken }]
            }, { scope: scope, tags: ['tag1'] });
            program.diagnostics.register({ message: 'test2', location: subToken }, { tags: ['tag1'] });
            program.diagnostics.clearByFilter({ tag: 'tag2' });
            program.diagnostics.clearForFile('source/other.brs');
            expect(getLocationSpy.called).to.be.false;

            expectDiagnostics(program.getDiagnostics(), [{ message: 'test' }, { message: 'test2' }]);
            expect(getLocationSpy.called).to.be.true;

            program.diagnostics.clearForFile(file.srcPath);
            expectZeroDiagnostics(program.getDiagnostics());
        });

        it('clears by file for both locatable and Location diagnostics', () => {
            const { file, tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            const otherUri = util.pathToUri(s`${file.srcPath}/../other.brs`);
            program.diagnostics.register([
                { message: 'locatable', location: printToken },
                { message: 'location', location: util.getLocation(printToken) },
                { message: 'other', location: { uri: otherUri, range: util.createRange(1, 2, 3, 4) } }
            ]);

            program.diagnostics.clearForFile(file.srcPath);
            expectDiagnostics(program.getDiagnostics(), [{ message: 'other' }]);
        });

        it('clears by fileUri filter for locatable diagnostics', () => {
            const { file, tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            program.diagnostics.register({ message: 'test', location: printToken }, { tags: ['tag1'] });

            program.diagnostics.clearByFilter({ fileUri: util.pathToUri(file.srcPath), tag: 'tag1' });
            expectZeroDiagnostics(program.getDiagnostics());
        });

        it('dedupes the same locatable diagnostic from multiple scopes', () => {
            const { tokens } = getTokens('sub main()\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            const subToken = tokens.find(x => x.kind === TokenKind.Sub);
            const scope1 = new Scope('scope1', program);
            const scope2 = new Scope('scope2', program);
            const getDiagnostic = () => ({
                message: 'test',
                location: printToken,
                relatedInformation: [{ message: 'related', location: subToken }]
            });
            program.diagnostics.register([
                { diagnostic: getDiagnostic(), context: { scope: scope1 } },
                { diagnostic: getDiagnostic(), context: { scope: scope2 } }
            ]);

            const diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].relatedInformation).to.eql([
                { message: 'related', location: util.getLocation(subToken) },
                { message: `In scope 'scope1'`, location: util.getLocation(printToken) },
                { message: `In scope 'scope2'`, location: util.getLocation(printToken) }
            ]);
        });

        it('suppresses locatable diagnostics with comment flags', () => {
            const { tokens } = getTokens('sub main()\n    \'bs:disable-next-line\n    print "hello"\nend sub\n');
            const printToken = tokens.find(x => x.kind === TokenKind.Print);
            program.diagnostics.register({ message: 'test', code: 1234, location: printToken });
            expectZeroDiagnostics(program.getDiagnostics());
        });

        it('does not return or retain a synthetic token that has no position', () => {
            const { file } = getTokens('sub main()\nend sub\n');
            program.diagnostics.locationResolver = () => util.createLocation(0, 0, 0, 100, file.srcPath);
            const token = createToken(TokenKind.Identifier, 'synthetic');
            program.diagnostics.register({ message: 'test', location: token });

            const cached = [...program.diagnostics['diagnosticsCache'].values()][0].diagnostic;
            expect(cached.location).not.to.equal(token);
            expectDiagnostics(program.getDiagnostics(), [{
                message: 'test (location unknown, added here for visibility)',
                location: util.createLocation(0, 0, 0, 100, file.srcPath)
            }]);
        });

        it('uses the locationResolver for synthetic locatables', () => {
            const { file } = getTokens('sub main()\nend sub\n');
            program.diagnostics.locationResolver = () => util.createLocation(0, 0, 0, 100, file.srcPath);
            program.diagnostics.register({ message: 'test', location: { pos: 0, end: 0, source: undefined } });
            expectDiagnostics(program.getDiagnostics(), [{
                message: 'test (location unknown, added here for visibility)',
                location: util.createLocation(0, 0, 0, 100, file.srcPath)
            }]);
        });
    });

    describe('canSkipScopeValidationForFile', () => {
        it('returns true if the DiagnosticFilterer says to filter the file', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            program.diagnostics['diagnosticFilterer'].isFileCompletelyFiltered = () => true;
            expect(program.diagnostics.canSkipScopeValidationForFile(file)).to.be.true;
        });

        it('returns false if the DiagnosticFilterer says not to filter the file', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            program.diagnostics['diagnosticFilterer'].isFileCompletelyFiltered = () => false;
            expect(program.diagnostics.canSkipScopeValidationForFile(file)).to.be.false;
        });
    });
});
