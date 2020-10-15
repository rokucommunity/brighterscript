import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';
import { DidChangeWatchedFilesParams, FileChangeType, Range } from 'vscode-languageserver';
import { Deferred } from './deferred';
import { LanguageServer, Workspace } from './LanguageServer';
import { ProgramBuilder } from './ProgramBuilder';
import { Program } from './Program';
import * as sinonImport from 'sinon';
import { standardizePath as s, util } from './util';
import { TextDocument } from 'vscode-languageserver-textdocument';

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
        onDocumentSymbol: () => null,
        onWorkspaceSymbol: () => null,
        onDefinition: () => null,
        onSignatureHelp: () => null,
        onReferences: () => null,
        onHover: () => null,
        listen: () => null,
        sendNotification: () => null,
        sendDiagnostics: () => null,
        onExecuteCommand: () => null,
        onDidOpenTextDocument: () => null,
        onDidChangeTextDocument: () => null,
        onDidCloseTextDocument: () => null,
        onWillSaveTextDocument: () => null,
        onWillSaveTextDocumentWaitUntil: () => null,
        onDidSaveTextDocument: () => null,
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

    describe('onSignatureHelp', () => {
        let program: Program;
        let callDocument: TextDocument;
        const functionFileBaseName = 'buildAwesome';
        const funcDefinitionLine = 'function buildAwesome()';
        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;

            let name = `CallComponent`;
            callDocument = await addBrsFile(name, `sub init()
                shouldBuildAwesome = true
                if shouldBuildAwesome then
                    buildAwesome()
                else
                    m.buildAwesome()
                end if
            end sub`);
            await addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.brs" />`);
        });

        async function addXmlFile(name: string, additionalXmlContents = '') {
            const filePath = `components/${name}.xml`;

            const contents = `<?xml version="1.0" encoding="utf-8"?>
            <component name="${name}" extends="Group">
                ${additionalXmlContents}
                <script type="text/brightscript" uri="${name}.brs" />
            </component>`;
            await program.addOrReplaceFile(filePath, contents);
        }

        async function addBrsFile(name: string, contents: string) {
            const filePath = `components/${name}.brs`;

            await program.addOrReplaceFile(filePath, contents);
            for (const key in program.files) {
                if (key.includes(filePath)) {
                    const document = TextDocument.create(util.pathToUri(key), 'brightscript', 1, contents);
                    svr.documents._documents[document.uri] = document;
                    return document;
                }
            }
        }

        it('should return the expected signature info when a documentation is included', async () => {
            const funcDescriptionComment = '@description Builds awesome for you';
            const funcReturnComment = '@return {Integer} The key to everything';

            await addBrsFile(functionFileBaseName, `' /**
            ' * ${funcDescriptionComment}
            ' * ${funcReturnComment}
            ' */
            ${funcDefinitionLine}
                return 42
            end function`);

            const result = await svr.onSignatureHelp({
                textDocument: {
                    uri: callDocument.uri
                },
                position: util.createPosition(3, 33)
            });
            expect(result.signatures).to.not.be.empty;
            const signature = result.signatures[0];
            expect(signature.label).to.equal(funcDefinitionLine);
            expect(signature.documentation).to.include(funcDescriptionComment);
            expect(signature.documentation).to.include(funcReturnComment);
        });

        it('should work if used on a property value', async () => {
            await addBrsFile(functionFileBaseName, `${funcDefinitionLine}
                return 42
            end function`);

            const result = await svr.onSignatureHelp({
                textDocument: {
                    uri: callDocument.uri
                },
                position: util.createPosition(5, 35)
            });
            expect(result.signatures).to.not.be.empty;
            const signature = result.signatures[0];
            expect(signature.label).to.equal(funcDefinitionLine);
        });
    });

    describe('onReferences', () => {
        let program: Program;
        let functionDocument: TextDocument;
        let referenceFileUris = [];

        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;

            let functionFileBaseName = 'buildAwesome';
            functionDocument = await addBrsFile(functionFileBaseName, `function buildAwesome()
                return 42
            end function`);

            for (let i = 0; i < 5; i++) {
                let name = `CallComponent${i}`;
                const document = await addBrsFile(name, `sub init()
                    shouldBuildAwesome = true
                    if shouldBuildAwesome then
                        buildAwesome()
                    end if
                end sub`);

                await addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.brs" />`);
                referenceFileUris.push(document.uri);
            }
        });

        async function addXmlFile(name: string, additionalXmlContents = '') {
            const filePath = `components/${name}.xml`;

            const contents = `<?xml version="1.0" encoding="utf-8"?>
            <component name="${name}" extends="Group">
                ${additionalXmlContents}
                <script type="text/brightscript" uri="${name}.brs" />
            </component>`;
            await program.addOrReplaceFile(filePath, contents);
        }

        async function addBrsFile(name: string, contents: string) {
            const filePath = `components/${name}.brs`;

            await program.addOrReplaceFile(filePath, contents);
            for (const key in program.files) {
                if (key.includes(filePath)) {
                    const document = TextDocument.create(util.pathToUri(key), 'brightscript', 1, contents);
                    svr.documents._documents[document.uri] = document;
                    return document;
                }
            }
        }

        it('should return the expected results if we entered on an identifier token', async () => {
            const references = await svr.onReferences({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(0, 13)
            });

            expect(references.length).to.equal(referenceFileUris.length);

            for (const reference of references) {
                expect(referenceFileUris).to.contain(reference.uri);
            }
        });

        it('should return an empty response if we entered on anything other than an identifier token', async () => {
            let references = await svr.onReferences({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(0, 0) // function token
            });

            expect(references).to.be.empty;

            references = await svr.onReferences({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(1, 20) // return token
            });

            expect(references).to.be.empty;
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
