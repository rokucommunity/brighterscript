import { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import { expectDiagnostics, expectZeroDiagnostics } from './testHelpers.spec';
import util from './util';
import { expect } from 'chai';


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
