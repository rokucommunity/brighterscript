import { BsDiagnostic } from '.';
import { DiagnosticCollection } from './DiagnosticCollection';
import { Workspace } from './LanguageServer';
import { ProgramBuilder } from './ProgramBuilder';
import { File } from './interfaces';
import util from './util';
import { expect } from 'chai';

describe.only('DiagnosticCollection', () => {
    let collection: DiagnosticCollection;
    let diagnostics: BsDiagnostic[];
    let workspaces: Workspace[];
    beforeEach(() => {
        collection = new DiagnosticCollection();
        diagnostics = [];
        //make simple mock of workspace to pass tests
        workspaces = [{
            firstRunPromise: Promise.resolve(),
            builder: {
                getDiagnostics: () => diagnostics
            } as ProgramBuilder
        }] as Workspace[];
    });

    async function testPatch(expected: { [filePath: string]: string[] }) {
        const patch = await collection.getPatch(workspaces);
        //convert the patch into our test structure
        const actual = {};
        for (const filePath in patch) {
            actual[filePath] = patch[filePath].map(x => x.message);
        }

        expect(actual).to.eql(expected);
    }

    it('returns full list of diagnostics on first call, and nothing on second call', async () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        addDiagnostics('file2.brs', ['message3', 'message4']);
        //first patch should return all
        await testPatch({
            'file1.brs': ['message1', 'message2'],
            'file2.brs': ['message3', 'message4']
        });

        //second patch should return empty (because nothing has changed)
        await testPatch({});
    });

    it('removes diagnostics in patch', async () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        addDiagnostics('file2.brs', ['message3', 'message4']);
        //first patch should return all
        await testPatch({
            'file1.brs': ['message1', 'message2'],
            'file2.brs': ['message3', 'message4']
        });
        removeDiagnostic('file1.brs', 'message1');
        removeDiagnostic('file1.brs', 'message2');
        await testPatch({
            'file1.brs': []
        });
    });

    it('adds diagnostics in patch', async () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        await testPatch({
            'file1.brs': ['message1', 'message2']
        });

        addDiagnostics('file2.brs', ['message3', 'message4']);
        await testPatch({
            'file2.brs': ['message3', 'message4']
        });
    });

    it('sends full list when file diagnostics have changed', async () => {
        addDiagnostics('file1.brs', ['message1', 'message2']);
        await testPatch({
            'file1.brs': ['message1', 'message2']
        });
        addDiagnostics('file1.brs', ['message3', 'message4']);
        await testPatch({
            'file1.brs': ['message1', 'message2', 'message3', 'message4']
        });
    });

    function removeDiagnostic(filePath: string, message: string) {
        for (let i = 0; i < diagnostics.length; i++) {
            const diagnostic = diagnostics[i];
            if (diagnostic.file.pathAbsolute === filePath && diagnostic.message === message) {
                diagnostics.splice(i, 1);
                return;
            }
        }
        throw new Error(`Cannot find diagnostic ${filePath}:${message}`);
    }

    function addDiagnostics(filePath: string, messages: string[]) {
        for (const message of messages) {
            diagnostics.push({
                file: {
                    pathAbsolute: filePath
                } as File,
                range: util.createRange(0, 0, 0, 0),
                //the code doesn't matter as long as the messages are different, so just enforce unique messages for this test files
                code: 123,
                message: message
            });
        }
    }
});
