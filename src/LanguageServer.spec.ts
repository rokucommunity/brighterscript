import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';
import type { DidChangeWatchedFilesParams, DocumentSymbol, Location } from 'vscode-languageserver';
import { FileChangeType, Range } from 'vscode-languageserver';
import { Deferred } from './deferred';
import type { Workspace } from './LanguageServer';
import { LanguageServer } from './LanguageServer';
import type { ProgramBuilder } from './ProgramBuilder';
import * as sinonImport from 'sinon';
import { standardizePath as s, util } from './util';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Program } from './Program';
import * as assert from 'assert';
import { expectZeroDiagnostics } from './testHelpers.spec';
import type { XmlFile } from './files/XmlFile';

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

    let vfs = {} as Record<string, string>;
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
        onCodeAction: () => null,
        onDidOpenTextDocument: () => null,
        onDidChangeTextDocument: () => null,
        onDidCloseTextDocument: () => null,
        onWillSaveTextDocument: () => null,
        onWillSaveTextDocumentWaitUntil: () => null,
        onDidSaveTextDocument: () => null,
        onRequest: () => null,
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
    let program: Program;

    beforeEach(() => {
        server = new LanguageServer();
        svr = server;
        workspaceFolders = [];
        vfs = {};
        physicalFilePaths = [];

        //hijack the file resolver so we can inject in-memory files for our tests
        let originalResolver = svr.documentFileResolver;
        svr.documentFileResolver = (srcPath: string) => {
            if (vfs[srcPath]) {
                return vfs[srcPath];
            } else {
                return originalResolver.call(svr, srcPath);
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
                physicalFilePaths.map(srcPath => fsExtra.unlinkSync(srcPath))
            );
        } catch (e) {

        }
        server.dispose();
    });

    function addXmlFile(name: string, additionalXmlContents = '') {
        const filePath = `components/${name}.xml`;

        const contents = `<?xml version="1.0" encoding="utf-8"?>
        <component name="${name}" extends="Group">
            ${additionalXmlContents}
            <script type="text/brightscript" uri="${name}.brs" />
        </component>`;
        program.setFile(filePath, contents);
    }

    function addScriptFile(name: string, contents: string, extension = 'brs') {
        const pkgPath = `pkg:/components/${name}.${extension}`;
        const file = program.setFile<XmlFile>(pkgPath, contents);
        if (file) {
            const document = TextDocument.create(util.pathToUri(file.srcPath), 'brightscript', 1, contents);
            svr.documents._documents[document.uri] = document;
            return document;
        }
    }

    function writeToFs(srcPath: string, contents: string) {
        physicalFilePaths.push(srcPath);
        fsExtra.ensureDirSync(path.dirname(srcPath));
        fsExtra.writeFileSync(srcPath, contents);
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
            expectZeroDiagnostics(firstWorkspace.builder.program);
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
                                srcPath: s`${rootDir}/source/main.brs`
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
                                srcPath: s`${rootDir}/source/main.brs`
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

            server.workspaces[0].configFilePath = `${workspacePath}/bsconfig.json`;
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
            let setFileStub = sinon.stub().returns(Promise.resolve());
            const workspace = {
                builder: {
                    options: {
                        files: [
                            'source/**/*'
                        ]
                    },
                    getFileContents: sinon.stub().callsFake(() => Promise.resolve('')) as any,
                    rootDir: rootDir,
                    program: {
                        setFile: <any>setFileStub
                    }
                }
            } as Workspace;

            let mainPath = s`${rootDir}/source/main.brs`;
            // setVfsFile(mainPath, 'sub main()\nend sub');

            await server.handleFileChanges(workspace, [{
                type: FileChangeType.Created,
                srcPath: mainPath
            }]);

            expect(setFileStub.getCalls()[0]?.args[0]).to.eql({
                src: mainPath,
                dest: s`source/main.brs`
            });

            let libPath = s`${rootDir}/components/lib.brs`;

            expect(setFileStub.callCount).to.equal(1);
            await server.handleFileChanges(workspace, [{
                type: FileChangeType.Created,
                srcPath: libPath
            }]);
            //the function should have ignored the lib file, so no additional files were added
            expect(setFileStub.callCount).to.equal(1);
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
                srcPath: s`${rootDir}/source/main.brs`
            }, {
                type: FileChangeType.Created,
                srcPath: s`${rootDir}/source/lib.brs`
            }]);
        });

        it('does not trigger revalidates when changes are in files which are not tracked', async () => {
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

            await (server as any).onDidChangeWatchedFiles({
                changes: [{
                    type: FileChangeType.Created,
                    uri: getFileProtocolPath('some/other/folder/maybe/some/vscode/settings')
                }]
            } as DidChangeWatchedFilesParams);

            expect(stub.callCount).to.equal(1);

            expect(stub.getCalls()[0].args[1]).to.eql([{
                type: FileChangeType.Created,
                srcPath: s`${rootDir}/source/main.brs`
            }, {
                type: FileChangeType.Created,
                srcPath: s`${rootDir}/source/lib.brs`
            }]);
        });
    });

    describe('onSignatureHelp', () => {
        let callDocument: TextDocument;
        const functionFileBaseName = 'buildAwesome';
        const funcDefinitionLine = 'function buildAwesome(confirm = true as Boolean)';
        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;

            const name = `CallComponent`;
            callDocument = addScriptFile(name, `
                sub init()
                    shouldBuildAwesome = true
                    if shouldBuildAwesome then
                        buildAwesome()
                    else
                        m.buildAwesome()
                    end if
                end sub
            `);
            addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.bs" />`);
        });

        it('should return the expected signature info when documentation is included', async () => {
            const funcDescriptionComment = '@description Builds awesome for you';
            const funcReturnComment = '@return {Integer} The key to everything';

            addScriptFile(functionFileBaseName, `
                ' /**
                ' * ${funcDescriptionComment}
                ' * ${funcReturnComment}
                ' */
                ${funcDefinitionLine}
                    return 42
                end function
            `, 'bs');

            const result = await svr.onSignatureHelp({
                textDocument: {
                    uri: callDocument.uri
                },
                position: util.createPosition(4, 37)
            });
            expect(result.signatures).to.not.be.empty;
            const signature = result.signatures[0];
            expect(signature.label).to.equal(funcDefinitionLine);
            expect(signature.documentation).to.include(funcDescriptionComment);
            expect(signature.documentation).to.include(funcReturnComment);
        });

        it('should work if used on a property value', async () => {
            addScriptFile(functionFileBaseName, `
                ${funcDefinitionLine}
                    return 42
                end function
            `, 'bs');

            const result = await svr.onSignatureHelp({
                textDocument: {
                    uri: callDocument.uri
                },
                position: util.createPosition(6, 39)
            });
            expect(result.signatures).to.not.be.empty;
            const signature = result.signatures[0];
            expect(signature.label).to.equal(funcDefinitionLine);
        });

        it('should give the correct signature for a class method', async () => {
            const classMethodDefinitionLine = 'function buildAwesome(classVersion = true as Boolean)';
            addScriptFile(functionFileBaseName, `
                class ${functionFileBaseName}
                    ${classMethodDefinitionLine}
                        return 42
                    end function
                end class
            `, 'bs');

            const result = await svr.onSignatureHelp({
                textDocument: {
                    uri: callDocument.uri
                },
                position: util.createPosition(6, 39)
            });

            expect(result.signatures).to.not.be.empty;
            const signature = result.signatures[0];
            expect(signature.label).to.equal(classMethodDefinitionLine);
        });
    });

    describe('onReferences', () => {
        let functionDocument: TextDocument;
        let referenceFileUris = [];

        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;

            const functionFileBaseName = 'buildAwesome';
            functionDocument = addScriptFile(functionFileBaseName, `
                function buildAwesome()
                    return 42
                end function
            `);

            for (let i = 0; i < 5; i++) {
                let name = `CallComponent${i}`;
                const document = addScriptFile(name, `
                    sub init()
                        shouldBuildAwesome = true
                        if shouldBuildAwesome then
                            buildAwesome()
                        end if
                    end sub
                `);

                addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.brs" />`);
                referenceFileUris.push(document.uri);
            }
        });

        it('should return the expected results if we entered on an identifier token', async () => {
            const references = await svr.onReferences({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(1, 32)
            });

            expect(references.length).to.equal(referenceFileUris.length);

            for (const reference of references) {
                expect(referenceFileUris).to.contain(reference.uri);
            }
        });

        it('should return an empty response if we entered on a token that should not return any results', async () => {
            let references = await svr.onReferences({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(1, 20) // function token
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

    describe('onDefinition', () => {
        let functionDocument: TextDocument;
        let referenceDocument: TextDocument;

        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;

            const functionFileBaseName = 'buildAwesome';
            functionDocument = addScriptFile(functionFileBaseName, `
                function pi()
                    return 3.141592653589793
                end function

                function buildAwesome()
                    return 42
                end function
            `);

            const name = `CallComponent`;
            referenceDocument = addScriptFile(name, `
                sub init()
                    shouldBuildAwesome = true
                    if shouldBuildAwesome then
                        buildAwesome()
                    else
                        m.top.observeFieldScope("loadFinished", "buildAwesome")
                    end if
                end sub
            `);

            addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.brs" />`);
        });

        it('should return the expected location if we entered on an identifier token', async () => {
            const locations = await svr.onDefinition({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(4, 33)
            });

            expect(locations.length).to.equal(1);
            const location: Location = locations[0];
            expect(location.uri).to.equal(functionDocument.uri);
            expect(location.range.start.line).to.equal(5);
            expect(location.range.start.character).to.equal(16);
        });

        it('should return the expected location if we entered on a StringLiteral token', async () => {
            const locations = await svr.onDefinition({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(6, 77)
            });

            expect(locations.length).to.equal(1);
            const location: Location = locations[0];
            expect(location.uri).to.equal(functionDocument.uri);
            expect(location.range.start.line).to.equal(5);
            expect(location.range.start.character).to.equal(16);
        });

        it('should return nothing if neither StringLiteral or identifier token entry point', async () => {
            const locations = await svr.onDefinition({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(1, 18)
            });

            expect(locations).to.be.empty;
        });

        it('should work on local variables as well', async () => {
            const locations = await svr.onDefinition({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(3, 36)
            });
            expect(locations.length).to.equal(1);
            const location: Location = locations[0];
            expect(location.uri).to.equal(referenceDocument.uri);
            expect(location.range.start.line).to.equal(2);
            expect(location.range.start.character).to.equal(20);
            expect(location.range.end.line).to.equal(2);
            expect(location.range.end.character).to.equal(38);
        });

        it('should work for bs class functions as well', async () => {
            const functionFileBaseName = 'Build';
            functionDocument = addScriptFile(functionFileBaseName, `
                class ${functionFileBaseName}
                    function awesome()
                        return 42
                    end function
                end class
            `, 'bs');

            const name = `CallComponent`;
            referenceDocument = addScriptFile(name, `
                sub init()
                    build = new Build()
                    build.awesome()
                end sub
            `);

            addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.bs" />`);

            const locations = await svr.onDefinition({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(3, 30)
            });
            expect(locations.length).to.equal(1);
            const location: Location = locations[0];
            expect(location.uri).to.equal(functionDocument.uri);
            expect(location.range).to.eql(util.createRange(2, 20, 4, 32));
        });
    });

    describe('onDocumentSymbol', () => {
        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;
        });

        it('should return the expected symbols even if pulled from cache', async () => {
            const document = addScriptFile('buildAwesome', `
                function pi()
                    return 3.141592653589793
                end function

                function buildAwesome()
                    return 42
                end function
            `);

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await svr.onDocumentSymbol({
                    textDocument: document
                });
                expect(symbols.length).to.equal(2);
                expect(symbols[0].name).to.equal('pi');
                expect(symbols[1].name).to.equal('buildAwesome');
            }
        });

        it('should work for brightscript classes as well', async () => {
            const document = addScriptFile('MyFirstClass', `
                class MyFirstClass
                    function pi()
                        return 3.141592653589793
                    end function

                    function buildAwesome()
                        return 42
                    end function
                end class
            `, 'bs');

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await svr.onDocumentSymbol({
                    textDocument: document
                }) as DocumentSymbol[];

                expect(symbols.length).to.equal(1);
                const classSymbol = symbols[0];
                expect(classSymbol.name).to.equal('MyFirstClass');
                const classChildrenSymbols = classSymbol.children;
                expect(classChildrenSymbols.length).to.equal(2);
                expect(classChildrenSymbols[0].name).to.equal('pi');
                expect(classChildrenSymbols[1].name).to.equal('buildAwesome');
            }
        });

        it('should work for brightscript namespaces as well', async () => {
            const document = addScriptFile('MyFirstNamespace', `
                namespace MyFirstNamespace
                    function pi()
                        return 3.141592653589793
                    end function

                    function buildAwesome()
                        return 42
                    end function
                end namespace
            `, 'bs');

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await svr.onDocumentSymbol({
                    textDocument: document
                }) as DocumentSymbol[];

                expect(symbols.length).to.equal(1);
                const namespaceSymbol = symbols[0];
                expect(namespaceSymbol.name).to.equal('MyFirstNamespace');
                const classChildrenSymbols = namespaceSymbol.children;
                expect(classChildrenSymbols.length).to.equal(2);
                expect(classChildrenSymbols[0].name).to.equal('MyFirstNamespace.pi');
                expect(classChildrenSymbols[1].name).to.equal('MyFirstNamespace.buildAwesome');
            }
        });
    });

    describe('onWorkspaceSymbol', () => {
        beforeEach(async () => {
            svr.connection = svr.createConnection();
            await svr.createWorkspace(s`${rootDir}/TestRokuApp`);
            program = svr.workspaces[0].builder.program;
        });

        it('should return the expected symbols even if pulled from cache', async () => {
            const className = 'MyFirstClass';
            const namespaceName = 'MyFirstNamespace';

            addScriptFile('buildAwesome', `
                function pi()
                    return 3.141592653589793
                end function

                function buildAwesome()
                    return 42
                end function
            `);

            addScriptFile(className, `
                class ${className}
                    function ${className}pi()
                        return 3.141592653589793
                    end function

                    function ${className}buildAwesome()
                        return 42
                    end function
                end class
            `, 'bs');


            addScriptFile(namespaceName, `
                namespace ${namespaceName}
                    function pi()
                        return 3.141592653589793
                    end function

                    function buildAwesome()
                        return 42
                    end function
                end namespace
            `, 'bs');

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await svr.onWorkspaceSymbol();
                expect(symbols.length).to.equal(8);
                for (const symbol of symbols) {
                    switch (symbol.name) {
                        case 'pi':
                            break;
                        case 'buildAwesome':
                            break;
                        case `${className}`:
                            break;
                        case `${className}pi`:
                            expect(symbol.containerName).to.equal(className);
                            break;
                        case `${className}buildAwesome`:
                            expect(symbol.containerName).to.equal(className);
                            break;
                        case `${namespaceName}`:
                            break;
                        case `${namespaceName}.pi`:
                            expect(symbol.containerName).to.equal(namespaceName);
                            break;
                        case `${namespaceName}.buildAwesome`:
                            expect(symbol.containerName).to.equal(namespaceName);
                            break;
                        default:
                            assert.fail(`'${symbol.name}' was not expected in list of symbols`);
                    }
                }
            }
        });

        it('should work for nested class as well', async () => {
            const nestedNamespace = 'containerNamespace';
            const nestedClassName = 'nestedClass';

            addScriptFile('nested', `
                namespace ${nestedNamespace}
                    class ${nestedClassName}
                        function pi()
                            return 3.141592653589793
                        end function

                        function buildAwesome()
                            return 42
                        end function
                    end class
                end namespace
            `, 'bs');

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await svr.onWorkspaceSymbol();
                expect(symbols.length).to.equal(4);
                expect(symbols[0].name).to.equal(`pi`);
                expect(symbols[0].containerName).to.equal(`${nestedNamespace}.${nestedClassName}`);
                expect(symbols[1].name).to.equal(`buildAwesome`);
                expect(symbols[1].containerName).to.equal(`${nestedNamespace}.${nestedClassName}`);
                expect(symbols[2].name).to.equal(`${nestedNamespace}.${nestedClassName}`);
                expect(symbols[2].containerName).to.equal(nestedNamespace);
                expect(symbols[3].name).to.equal(nestedNamespace);
            }
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
