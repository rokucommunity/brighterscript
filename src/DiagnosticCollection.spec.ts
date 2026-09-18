import type { BsDiagnostic } from '.';
import { DiagnosticCollection } from './DiagnosticCollection';
import type { Project } from './LanguageServer';
import type { ProgramBuilder } from './ProgramBuilder';
import type { BscFile } from './interfaces';
import util from './util';
import { expect } from './chai-config.spec';

describe('DiagnosticCollection', () => {
    let collection: DiagnosticCollection;
    let diagnostics: BsDiagnostic[];
    let projects: Project[];
    beforeEach(() => {
        collection = new DiagnosticCollection();
        diagnostics = [];
        //make simple mock of workspace to pass tests
        projects = [{
            firstRunPromise: Promise.resolve(),
            builder: {
                getDiagnostics: () => diagnostics
            } as ProgramBuilder
        }] as Project[];
    });

    function testPatch(expected: Record<string, string[]>) {
        const patch = collection.getPatch(projects);
        //convert the patch into our test structure
        const actual = {};
        for (const filePath in patch) {
            actual[filePath] = patch[filePath].map(x => x.message);
        }

        expect(actual).to.eql(expected);
    }

    it('does not crash for diagnostics with missing locations', () => {
        const [d1] = addDiagnostics('file1.brs', ['I have no location']);
        delete (d1 as any).range;
        testPatch({
            'file1.brs': ['I have no location']
        });
    });

    it('returns full list of diagnostics on first call, and nothing on second call', () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        addDiagnostics('file2.brs', ['message3', 'message4']);
        //first patch should return all
        testPatch({
            'file1.brs': ['message1', 'message2'],
            'file2.brs': ['message3', 'message4']
        });

        //second patch should return empty (because nothing has changed)
        testPatch({});
    });

    it('removes diagnostics in patch', () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        addDiagnostics('file2.brs', ['message3', 'message4']);
        //first patch should return all
        testPatch({
            'file1.brs': ['message1', 'message2'],
            'file2.brs': ['message3', 'message4']
        });
        removeDiagnostic('file1.brs', 'message1');
        removeDiagnostic('file1.brs', 'message2');
        testPatch({
            'file1.brs': []
        });
    });

    it('adds diagnostics in patch', () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        testPatch({
            'file1.brs': ['message1', 'message2']
        });

        addDiagnostics('file2.brs', ['message3', 'message4']);
        testPatch({
            'file2.brs': ['message3', 'message4']
        });
    });

    it('sends full list when file diagnostics have changed', () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        testPatch({
            'file1.brs': ['message1', 'message2']
        });
        addDiagnostics('file1.brs', ['message3', 'message4']);
        testPatch({
            'file1.brs': ['message1', 'message2', 'message3', 'message4']
        });
    });

    function removeDiagnostic(srcPath: string, message: string) {
        for (let i = 0; i < diagnostics.length; i++) {
            const diagnostic = diagnostics[i];
            if (diagnostic.file.srcPath === srcPath && diagnostic.message === message) {
                diagnostics.splice(i, 1);
                return;
            }
        }
        throw new Error(`Cannot find diagnostic ${srcPath}:${message}`);
    }

    function addDiagnostics(srcPath: string, messages: string[]) {
        const newDiagnostics: BsDiagnostic[] = [];
        for (const message of messages) {
            newDiagnostics.push({
                file: {
                    srcPath: srcPath
                } as BscFile,
                range: util.createRange(0, 0, 0, 0),
                //the code doesn't matter as long as the messages are different, so just enforce unique messages for this test files
                code: 123,
                message: message
            });
        }
        diagnostics.push(...newDiagnostics);
        return newDiagnostics;
    }
});
