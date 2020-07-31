import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';
import { DidChangeWatchedFilesParams, FileChangeType, TextDocumentSyncKind, Range } from 'vscode-languageserver';
import { Deferred } from './deferred';
import { LanguageServer, Workspace } from './LanguageServer';
import { ProgramBuilder } from './ProgramBuilder';
import * as sinonImport from 'sinon';
import { standardizePath as s, util } from './util';

let sinon: sinonImport.SinonSandbox;
beforeEach(() => {
    sinon = sinonImport.createSandbox();
});
afterEach(() => {
    sinon.restore();
});

let rootDir = s`${process.cwd()}`;

describe('LanguageServer', () => {
    let server: LanguageServer;
    //an any version of the server for easier private testing
    let svr: any;
    let workspaceFolders: Array<{
        uri: string;
        name: string;
    }>;

    let vfs = {} as { [filePath: string]: string };
    let physicalFilePaths = [] as string[];
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
        onExecuteCommand: () => null,
        workspace: {
            getWorkspaceFolders: () => workspaceFolders,
            getConfiguration: () => {
                return {};
            }
        },
        tracer: {
            log: () => { }
        }
    };

    beforeEach(() => {
        server = new LanguageServer();
        svr = server;
        workspaceFolders = [];
        vfs = {};
        physicalFilePaths = [];

        //hijack the file resolver so we can inject in-memory files for our tests
        let originalResolver = svr.documentFileResolver;
        svr.documentFileResolver = (pathAbsolute: string) => {
            if (vfs[pathAbsolute]) {
                return vfs[pathAbsolute];
            } else {
                return originalResolver.call(svr, pathAbsolute);
            }
        };

        //mock the connection stuff
        svr.createConnection = () => {
            return connection;
        };

        svr.documents = {
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
        server.dispose();
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
            let firstWorkspace = await svr.createStandaloneFileWorkspace(filePath);
            let secondWorkspace = await svr.createStandaloneFileWorkspace(filePath);
            expect(firstWorkspace).to.equal(secondWorkspace);
        });

        it('filters out certain diagnostics', async () => {
            let filePath = `${rootDir}/.tmp/main.brs`;
            writeToFs(filePath, `sub main(): return: end sub`);
            let firstWorkspace: Workspace = await svr.createStandaloneFileWorkspace(filePath);
            expect(
                firstWorkspace.builder.program.getDiagnostics().map(x => x.message).sort()
            ).to.eql([]);
        });
    });

    describe('sendDiagnostics', () => {
        it('waits for program to finish loading before sending diagnostics', async () => {
            svr.onInitialize({
                capabilities: {
                    workspace: {
                        workspaceFolders: true
                    }
                }
            });
            expect(svr.clientHasWorkspaceFolderCapability).to.be.true;
            server.run();
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
            let p = svr.sendDiagnostics();
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

        it('dedupes diagnostics found at same location from multiple projects', async () => {
            server.workspaces.push(<any>{
                firstRunPromise: Promise.resolve(),
                builder: {
                    getDiagnostics: () => {
                        return [{
                            file: {
                                pathAbsolute: s`${rootDir}/source/main.brs`
                            },
                            code: 1000,
                            range: Range.create(1, 2, 3, 4)
                        }];
                    }
                }
            }, <any>{
                firstRunPromise: Promise.resolve(),
                builder: {
                    getDiagnostics: () => {
                        return [{
                            file: {
                                pathAbsolute: s`${rootDir}/source/main.brs`
                            },
                            code: 1000,
                            range: Range.create(1, 2, 3, 4)
                        }];
                    }
                }
            });
            svr.connection = connection;
            let stub = sinon.stub(svr.connection, 'sendDiagnostics');
            await svr.sendDiagnostics();
            expect(stub.getCall(0).args?.[0]?.diagnostics).to.be.lengthOf(1);
        });
    });

    describe('createWorkspace', () => {
        it('prevents creating package on first run', async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            expect((svr.workspaces[0].builder as ProgramBuilder).program.options.copyToStaging).to.be.false;
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        let workspacePath = s`${rootDir}/TestRokuApp`;
        let mainPath = s`${workspacePath}/source/main.brs`;

        it('picks up new files', async () => {
            workspaceFolders = [{
                uri: getFileProtocolPath(workspacePath),
                name: 'TestProject'
            }];

            svr.run();
            svr.onInitialize({
                capabilities: {
                }
            });
            writeToFs(mainPath, `sub main(): return: end sub`);
            await svr.onInitialized();
            expect(server.workspaces[0].builder.program.hasFile(mainPath)).to.be.true;
            //move a file into the directory...the program should detect it
            let libPath = s`${workspacePath}/source/lib.brs`;
            writeToFs(libPath, 'sub lib(): return : end sub');

            await svr.onDidChangeWatchedFiles({
                changes: [{
                    uri: getFileProtocolPath(libPath),
                    type: 1 //created
                },
                {
                    uri: getFileProtocolPath(s`${workspacePath}/source`),
                    type: 2 //changed
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

    describe('handleFileChanges', () => {
        it('only adds files that match the files array', async () => {
            let addOrReplaceFileStub = sinon.stub().returns(Promise.resolve());
            const workspace = {
                builder: {
                    options: {
                        files: [
                            'source/**/*'
                        ]
                    },
                    rootDir: rootDir,
                    program: {
                        addOrReplaceFile: <any>addOrReplaceFileStub
                    }
                }
            } as Workspace;

            let mainPath = s`${rootDir}/source/main.brs`;
            // setVfsFile(mainPath, 'sub main()\nend sub');

            await server.handleFileChanges(workspace, [{
                type: FileChangeType.Created,
                pathAbsolute: mainPath
            }]);

            expect(addOrReplaceFileStub.getCalls()[0].args[0]).to.eql({
                src: mainPath,
                dest: s`source/main.brs`
            });

            let libPath = s`${rootDir}/components/lib.brs`;

            expect(addOrReplaceFileStub.callCount).to.equal(1);
            await server.handleFileChanges(workspace, [{
                type: FileChangeType.Created,
                pathAbsolute: libPath
            }]);
            //the function should have ignored the lib file, so no additional files were added
            expect(addOrReplaceFileStub.callCount).to.equal(1);
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        it('converts folder paths into an array of file paths', async () => {
            svr.connection = {
                sendNotification: () => { }
            };
            svr.workspaces.push({
                builder: {
                    getDiagnostics: () => [],
                    program: {
                        validate: () => { }
                    }
                }
            });

            sinon.stub(util, 'isDirectorySync').returns(true);
            sinon.stub(glob, 'sync').returns([
                s`${rootDir}/source/main.brs`,
                s`${rootDir}/source/lib.brs`
            ]);
            const stub = sinon.stub(server, 'handleFileChanges').returns(Promise.resolve());

            let sourcePath = s`${rootDir}/source`;
            await (server as any).onDidChangeWatchedFiles({
                changes: [{
                    type: FileChangeType.Created,
                    uri: getFileProtocolPath(sourcePath)
                }]
            } as DidChangeWatchedFilesParams);

            expect(stub.callCount).to.equal(1);

            expect(stub.getCalls()[0].args[1]).to.eql([{
                type: FileChangeType.Created,
                pathAbsolute: s`${rootDir}/source/main.brs`
            }, {
                type: FileChangeType.Created,
                pathAbsolute: s`${rootDir}/source/lib.brs`
            }]);
        });
    });
});

export function getFileProtocolPath(fullPath: string) {
    let result: string;
    if (fullPath.startsWith('/') || fullPath.startsWith('\\')) {
        result = `file://${fullPath}`;
    } else {
        result = `file:///${fullPath}`;
    }
    return result;
}
