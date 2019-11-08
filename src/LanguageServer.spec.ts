import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { TextDocumentSyncKind } from 'vscode-languageserver';

import * as sinonImport from 'sinon';
let sinon: sinonImport.SinonSandbox;
beforeEach(() => {
    sinon = sinonImport.createSandbox();
});
afterEach(() => {
    sinon.restore();
});

import { Deferred } from './deferred';
import { LanguageServer } from './LanguageServer';
import { getFileProtocolPath } from './ProgramBuilder.spec';
import util from './util';
let rootDir = process.cwd();
let n = path.normalize;

describe('LanguageServer', () => {
    let server: LanguageServer;
    //an any version of the server for easier private testing
    let s: any;
    let workspaceFolders: Array<{
        uri: string;
        name: string;
    }>;

    let vfs = {} as { [filePath: string]: string };
    let physicalFilePaths = [] as string[];

    beforeEach(() => {
        server = new LanguageServer();
        s = server;
        workspaceFolders = [];
        vfs = {};
        physicalFilePaths = [];

        //hijack the file resolver so we can inject in-memory files for our tests
        let originalResolver = s.documentFileResolver;
        s.documentFileResolver = (pathAbsolute: string) => {
            if (vfs[pathAbsolute]) {
                return vfs[pathAbsolute];
            } else {
                return originalResolver.call(s, pathAbsolute);
            }
        };

        //mock the connection stuff
        s.createConnection = () => {
            let connection = {
                onInitialize: () => null,
                onInitialized: () => null,
                onDidChangeConfiguration: () => null,
                onDidChangeWatchedFiles: () => null,
                onCompletion: () => null,
                onCompletionResolve: () => null,
                onDefinition: () => null,
                onHover: () => null,
                listen: () => null,
                sendNotification: () => null,
                sendDiagnostics: () => null,
                workspace: {
                    getWorkspaceFolders: () => workspaceFolders,
                    getConfiguration: () => { return {}; }
                }
            };
            return connection;
        };

        s.documents = {
            onDidChangeContent: () => null,
            onDidClose: () => null,
            listen: () => null,
            get: () => { },
            all: () => [],
            syncKind: TextDocumentSyncKind.Full
        };
    });
    afterEach(async () => {
        try {
            await Promise.all(
                physicalFilePaths.map(pathAbsolute => fsExtra.unlinkSync(pathAbsolute))
            );
        } catch (e) {

        }
    });

    function writeToFs(pathAbsolute: string, contents: string) {
        physicalFilePaths.push(pathAbsolute);
        fsExtra.ensureDirSync(path.dirname(pathAbsolute));
        fsExtra.writeFileSync(pathAbsolute, contents);
    }

    describe('createStandaloneFileWorkspace', () => {
        it('never returns undefined', async () => {
            let filePath = `${rootDir}/.tmp/main.brs`;
            writeToFs(filePath, `sub main(): return: end sub`);
            let firstWorkspace = await s.createStandaloneFileWorkspace(filePath);
            let secondWorkspace = await s.createStandaloneFileWorkspace(filePath);
            expect(firstWorkspace).to.equal(secondWorkspace);
        });
    });

    describe('sendDiagnostics', () => {
        it('waits for program to finish loading before sending diagnostics', async () => {
            s.onInitialize({
                capabilities: {
                    workspace: {
                        workspaceFolders: true
                    }
                }
            });
            expect(s.clientHasWorkspaceFolderCapability).to.be.true;
            await server.run();
            let deferred = new Deferred();
            let workspace: any = {
                builder: {
                    getDiagnostics: () => []
                },
                firstRunPromise: deferred.promise
            };
            //make a new not-completed workspace
            server.workspaces.push(workspace);

            //this call should wait for the builder to finish
            let p = s.sendDiagnostics();
            // await s.createWorkspaces(
            await util.sleep(50);
            //simulate the program being created
            workspace.builder.program = {
                files: {}
            };
            deferred.resolve();
            await p;
            //test passed because no exceptions were thrown
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        let workspacePath = n(`${rootDir}/TestRokuApp`);
        let mainPath = n(`${workspacePath}/source/main.brs`);

        it('picks up new files', async () => {
            workspaceFolders = [{
                uri: getFileProtocolPath(workspacePath),
                name: 'TestProject'
            }];

            s.run();
            s.onInitialize({
                capabilities: {
                }
            });
            writeToFs(mainPath, `sub main(): return: end sub`);
            await s.onInitialized();
            expect(server.workspaces[0].builder.program.hasFile(mainPath)).to.be.true;
            //move a file into the directory...the program should detect it
            let libPath = n(`${workspacePath}/source/lib.brs`);
            writeToFs(libPath, 'sub lib(): return : end sub');

            await s.onDidChangeWatchedFiles({
                changes: [{
                    uri: getFileProtocolPath(libPath),
                    type: 1 //created
                },
                {
                    uri: getFileProtocolPath(path.join(workspacePath, 'source')),
                    type: 2 //changedasdf

                }
                    // ,{
                    //     uri: 'file:///c%3A/projects/PlumMediaCenter/Roku/appconfig.brs',
                    //     type: 3 //deleted
                    // }
                ]
            });
            expect(server.workspaces[0].builder.program.hasFile(libPath)).to.be.true;
        });
    });
});
