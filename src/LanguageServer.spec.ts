import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import type { DidChangeWatchedFilesParams, Location } from 'vscode-languageserver';
import { FileChangeType, Range } from 'vscode-languageserver';
import { Deferred } from './deferred';
import type { Project } from './LanguageServer';
import { CustomCommands, LanguageServer } from './LanguageServer';
import type { SinonStub } from 'sinon';
import { createSandbox } from 'sinon';
import { standardizePath as s, util } from './util';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Program } from './Program';
import * as assert from 'assert';
import { expectZeroDiagnostics, trim } from './testHelpers.spec';
import { isBrsFile, isLiteralString } from './astUtils/reflection';
import { createVisitor, WalkMode } from './astUtils/visitors';

const sinon = createSandbox();

const tempDir = s`${__dirname}/../.tmp`;
const rootDir = s`${tempDir}/TestApp`;
const workspacePath = rootDir;

describe('LanguageServer', () => {
    let server: LanguageServer;
    let program: Program;

    let workspaceFolders: string[] = [];

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
            getWorkspaceFolders: () => {
                return workspaceFolders.map(
                    x => ({
                        uri: getFileProtocolPath(x),
                        name: path.basename(x)
                    })
                );
            },
            getConfiguration: () => {
                return {};
            }
        },
        tracer: {
            log: () => { }
        }
    };

    beforeEach(() => {
        sinon.restore();
        server = new LanguageServer();
        workspaceFolders = [workspacePath];

        vfs = {};
        physicalFilePaths = [];

        //hijack the file resolver so we can inject in-memory files for our tests
        let originalResolver = server['documentFileResolver'];
        server['documentFileResolver'] = (srcPath: string) => {
            if (vfs[srcPath]) {
                return vfs[srcPath];
            } else {
                return originalResolver.call(server, srcPath);
            }
        };

        //mock the connection stuff
        (server as any).createConnection = () => {
            return connection;
        };
    });
    afterEach(async () => {
        fsExtra.emptyDirSync(tempDir);
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
        const filePath = s`components/${name}.${extension}`;
        const file = program.setFile(filePath, contents);
        if (file) {
            const document = TextDocument.create(util.pathToUri(file.srcPath), 'brightscript', 1, contents);
            server['documents']['_documents'][document.uri] = document;
            return document;
        }
    }

    function writeToFs(srcPath: string, contents: string) {
        physicalFilePaths.push(srcPath);
        fsExtra.ensureDirSync(path.dirname(srcPath));
        fsExtra.writeFileSync(srcPath, contents);
    }

    describe('createStandaloneFileProject', () => {
        it('never returns undefined', async () => {
            let filePath = `${rootDir}/.tmp/main.brs`;
            writeToFs(filePath, `sub main(): return: end sub`);
            let firstProject = await server['createStandaloneFileProject'](filePath);
            let secondProject = await server['createStandaloneFileProject'](filePath);
            expect(firstProject).to.equal(secondProject);
        });

        it('filters out certain diagnostics', async () => {
            let filePath = `${rootDir}/.tmp/main.brs`;
            writeToFs(filePath, `sub main(): return: end sub`);
            let firstProject: Project = await server['createStandaloneFileProject'](filePath);
            expectZeroDiagnostics(firstProject.builder.program);
        });
    });

    describe('sendDiagnostics', () => {
        it('waits for program to finish loading before sending diagnostics', async () => {
            server.onInitialize({
                capabilities: {
                    workspace: {
                        workspaceFolders: true
                    }
                }
            } as any);
            expect(server['clientHasWorkspaceFolderCapability']).to.be.true;
            server.run();
            let deferred = new Deferred();
            let project: any = {
                builder: {
                    getDiagnostics: () => []
                },
                firstRunPromise: deferred.promise
            };
            //make a new not-completed project
            server.projects.push(project);

            //this call should wait for the builder to finish
            let p = server['sendDiagnostics']();

            await util.sleep(50);
            //simulate the program being created
            project.builder.program = {
                files: {}
            };
            deferred.resolve();
            await p;
            //test passed because no exceptions were thrown
        });

        it('dedupes diagnostics found at same location from multiple projects', async () => {
            server.projects.push(<any>{
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
            server['connection'] = connection as any;
            let stub = sinon.stub(server['connection'], 'sendDiagnostics');
            await server['sendDiagnostics']();
            expect(stub.getCall(0).args?.[0]?.diagnostics).to.be.lengthOf(1);
        });

        it('sends diagnostics that were triggered by the program instead of vscode', async () => {
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            let stub: SinonStub;
            const promise = new Promise((resolve) => {
                stub = sinon.stub(connection, 'sendDiagnostics').callsFake(resolve as any);
            });
            const { program } = server.projects[0].builder;
            program.setFile('source/lib.bs', `
                sub lib()
                    functionDoesNotExist()
                end sub
            `);
            program.validate();
            await promise;
            expect(stub.called).to.be.true;
        });
    });

    describe('createProject', () => {
        it('prevents creating package on first run', async () => {
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            expect(server['projects'][0].builder.program.options.copyToStaging).to.be.false;
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        let mainPath = s`${workspacePath}/source/main.brs`;

        it('picks up new files', async () => {
            server.run();
            server.onInitialize({
                capabilities: {
                }
            } as any);
            writeToFs(mainPath, `sub main(): return: end sub`);
            await server['onInitialized']();
            expect(server.projects[0].builder.program.hasFile(mainPath)).to.be.true;
            //move a file into the directory...the program should detect it
            let libPath = s`${workspacePath}/source/lib.brs`;
            writeToFs(libPath, 'sub lib(): return : end sub');

            server.projects[0].configFilePath = `${workspacePath}/bsconfig.json`;
            await server['onDidChangeWatchedFiles']({
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
            expect(server.projects[0].builder.program.hasFile(libPath)).to.be.true;
        });
    });

    describe('handleFileChanges', () => {
        it('only adds files that match the files array', async () => {
            let setFileStub = sinon.stub().returns(Promise.resolve());
            const project = {
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
            } as Project;

            let mainPath = s`${rootDir}/source/main.brs`;
            // setVfsFile(mainPath, 'sub main()\nend sub');

            await server.handleFileChanges(project, [{
                type: FileChangeType.Created,
                srcPath: mainPath
            }]);

            expect(setFileStub.getCalls()[0]?.args[0]).to.eql({
                src: mainPath,
                dest: s`source/main.brs`
            });

            let libPath = s`${rootDir}/components/lib.brs`;

            expect(setFileStub.callCount).to.equal(1);
            await server.handleFileChanges(project, [{
                type: FileChangeType.Created,
                srcPath: libPath
            }]);
            //the function should have ignored the lib file, so no additional files were added
            expect(setFileStub.callCount).to.equal(1);
        });
    });

    describe('syncProjects', () => {
        it('loads workspace as project', async () => {
            server.run();

            expect(server.projects).to.be.lengthOf(0);

            fsExtra.ensureDirSync(workspacePath);

            await server['syncProjects']();

            //no child bsconfig.json files, use the workspacePath
            expect(
                server.projects.map(x => x.projectPath)
            ).to.eql([
                workspacePath
            ]);

            fsExtra.outputJsonSync(s`${workspacePath}/project1/bsconfig.json`, {});
            fsExtra.outputJsonSync(s`${workspacePath}/project2/bsconfig.json`, {});

            await server['syncProjects']();

            //2 child bsconfig.json files. Use those folders as projects, and don't use workspacePath
            expect(
                server.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${workspacePath}/project1`,
                s`${workspacePath}/project2`
            ]);

            fsExtra.removeSync(s`${workspacePath}/project2/bsconfig.json`);
            await server['syncProjects']();

            //1 child bsconfig.json file. Still don't use workspacePath
            expect(
                server.projects.map(x => x.projectPath)
            ).to.eql([
                s`${workspacePath}/project1`
            ]);

            fsExtra.removeSync(s`${workspacePath}/project1/bsconfig.json`);
            await server['syncProjects']();

            //back to no child bsconfig.json files. use workspacePath again
            expect(
                server.projects.map(x => x.projectPath)
            ).to.eql([
                workspacePath
            ]);
        });

        it('ignores bsconfig.json files from vscode ignored paths', async () => {
            server.run();
            sinon.stub(server['connection'].workspace, 'getConfiguration').returns(Promise.resolve({
                exclude: {
                    '**/vendor': true
                }
            }) as any);

            fsExtra.outputJsonSync(s`${workspacePath}/vendor/someProject/bsconfig.json`, {});
            //it always ignores node_modules
            fsExtra.outputJsonSync(s`${workspacePath}/node_modules/someProject/bsconfig.json`, {});

            await server['syncProjects']();

            //no child bsconfig.json files, use the workspacePath
            expect(
                server.projects.map(x => x.projectPath)
            ).to.eql([
                workspacePath
            ]);
        });

        it('ignores bsconfig.json files from vscode ignored paths', async () => {
            server.run();
            sinon.stub(server['connection'].workspace, 'getConfiguration').returns(Promise.resolve({
                exclude: {
                    '**/vendor': true
                }
            }) as any);

            fsExtra.outputJsonSync(s`${workspacePath}/vendor/someProject/bsconfig.json`, {});
            //it always ignores node_modules
            fsExtra.outputJsonSync(s`${workspacePath}/node_modules/someProject/bsconfig.json`, {});

            await server['syncProjects']();

            //no child bsconfig.json files, use the workspacePath
            expect(
                server.projects.map(x => x.projectPath)
            ).to.eql([
                workspacePath
            ]);
        });

        it('does not produce duplicate projects when subdir and parent dir are opened as workspace folders', async () => {
            fsExtra.outputJsonSync(s`${tempDir}/root/bsconfig.json`, {});
            fsExtra.outputJsonSync(s`${tempDir}/root/subdir/bsconfig.json`, {});

            workspaceFolders = [
                s`${tempDir}/root`,
                s`${tempDir}/root/subdir`
            ];

            server.run();
            await server['syncProjects']();

            expect(
                server.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${tempDir}/root`,
                s`${tempDir}/root/subdir`
            ]);
        });

        it('finds nested roku-like dirs', async () => {
            fsExtra.outputFileSync(s`${tempDir}/project1/manifest`, '');
            fsExtra.outputFileSync(s`${tempDir}/project1/source/main.brs`, '');

            fsExtra.outputFileSync(s`${tempDir}/sub/dir/project2/manifest`, '');
            fsExtra.outputFileSync(s`${tempDir}/sub/dir/project2/source/main.bs`, '');

            //does not match folder with manifest without a sibling ./source folder
            fsExtra.outputFileSync(s`${tempDir}/project3/manifest`, '');

            workspaceFolders = [
                s`${tempDir}/`
            ];

            server.run();
            await server['syncProjects']();

            expect(
                server.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${tempDir}/project1`,
                s`${tempDir}/sub/dir/project2`
            ]);
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        it('converts folder paths into an array of file paths', async () => {
            server.run();

            fsExtra.outputJsonSync(s`${rootDir}/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/lib.brs`, '');
            await server['syncProjects']();

            const stub2 = sinon.stub(server.projects[0].builder.program, 'setFile');

            await server['onDidChangeWatchedFiles']({
                changes: [{
                    type: FileChangeType.Created,
                    uri: getFileProtocolPath(s`${rootDir}/source`)
                }]
            } as DidChangeWatchedFilesParams);

            expect(
                stub2.getCalls().map(x => x.args[0].src).sort()
            ).to.eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
        });

        it('does not trigger revalidates when changes are in files which are not tracked', async () => {
            server.run();
            const externalDir = s`${tempDir}/not_app_dir`;
            fsExtra.outputJsonSync(s`${externalDir}/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${externalDir}/source/main.brs`, '');
            fsExtra.outputFileSync(s`${externalDir}/source/lib.brs`, '');
            await server['syncProjects']();

            const stub2 = sinon.stub(server.projects[0].builder.program, 'setFile');

            await server['onDidChangeWatchedFiles']({
                changes: [{
                    type: FileChangeType.Created,
                    uri: getFileProtocolPath(externalDir)
                }]
            } as DidChangeWatchedFilesParams);

            expect(
                stub2.getCalls()
            ).to.be.empty;
        });
    });

    describe('onSignatureHelp', () => {
        let callDocument: TextDocument;
        const functionFileBaseName = 'buildAwesome';
        const funcDefinitionLine = 'function buildAwesome(confirm = true as Boolean)';
        beforeEach(async () => {
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            program = server.projects[0].builder.program;

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

            const result = await server['onSignatureHelp']({
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

            const result = await server['onSignatureHelp']({
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

            const result = await server['onSignatureHelp']({
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
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            program = server.projects[0].builder.program;

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
            const references = await server['onReferences']({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(1, 32)
            } as any);

            expect(references.length).to.equal(referenceFileUris.length);

            for (const reference of references) {
                expect(referenceFileUris).to.contain(reference.uri);
            }
        });

        it('should return an empty response if we entered on a token that should not return any results', async () => {
            let references = await server['onReferences']({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util.createPosition(1, 20) // function token
            } as any);

            expect(references).to.be.empty;

            references = await server['onReferences']({
                textDocument: {
                    uri: functionDocument.uri
                },
                position: util['createPosition'](1, 20) // return token
            } as any);

            expect(references).to.be.empty;
        });
    });

    describe('onDefinition', () => {
        let functionDocument: TextDocument;
        let referenceDocument: TextDocument;

        beforeEach(async () => {
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            program = server.projects[0].builder.program;

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
            const locations = await server['onDefinition']({
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
            const locations = await server['onDefinition']({
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
            const locations = await server['onDefinition']({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(1, 18)
            });

            expect(locations).to.be.empty;
        });

        it('should work on local variables as well', async () => {
            const locations = await server['onDefinition']({
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

            const locations = await server['onDefinition']({
                textDocument: {
                    uri: referenceDocument.uri
                },
                position: util.createPosition(3, 30)
            });
            expect(locations.length).to.equal(1);
            const location: Location = locations[0];
            expect(location.uri).to.equal(functionDocument.uri);
            expect(location.range.start.line).to.equal(2);
            expect(location.range.start.character).to.equal(20);
            expect(location.range.end.line).to.equal(4);
            expect(location.range.end.character).to.equal(32);
        });
    });

    describe('onDocumentSymbol', () => {
        beforeEach(async () => {
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            program = server.projects[0].builder.program;
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
                const symbols = await server.onDocumentSymbol({
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
                const symbols = await server['onDocumentSymbol']({
                    textDocument: document
                });

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
                const symbols = await server['onDocumentSymbol']({
                    textDocument: document
                });

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
            server['connection'] = server['createConnection']();
            await server['createProject'](workspacePath);
            program = server.projects[0].builder.program;
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
                const symbols = await server['onWorkspaceSymbol']({} as any);
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
                const symbols = await server['onWorkspaceSymbol']({} as any);
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

    describe('getConfigFilePath', () => {
        it('honors the hasConfigurationCapability setting', async () => {
            server.run();
            sinon.stub(server['connection'].workspace, 'getConfiguration').returns(
                Promise.reject(
                    new Error('Client does not support "workspace/configuration"')
                )
            );
            server['hasConfigurationCapability'] = false;
            fsExtra.outputFileSync(`${workspacePath}/bsconfig.json`, '{}');
            expect(
                await server['getConfigFilePath'](workspacePath)
            ).to.eql(
                s`${workspacePath}/bsconfig.json`
            );
        });
    });

    describe('getWorkspaceExcludeGlobs', () => {
        it('honors the hasConfigurationCapability setting', async () => {
            server.run();
            sinon.stub(server['connection'].workspace, 'getConfiguration').returns(
                Promise.reject(
                    new Error('Client does not support "workspace/configuration"')
                )
            );
            server['hasConfigurationCapability'] = false;
            expect(
                await server['getWorkspaceExcludeGlobs'](workspaceFolders[0])
            ).to.eql([
                '**/node_modules/**/*'
            ]);
        });
    });

    describe('CustomCommands', () => {
        describe('TranspileFile', () => {
            it('returns pathAbsolute to support backwards compatibility', async () => {
                fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `
                    sub main()
                        print \`hello world\`
                    end sub
                `);
                fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, '');
                server.run();
                await server['syncProjects']();
                const result = await server.onExecuteCommand({
                    command: CustomCommands.TranspileFile,
                    arguments: [s`${rootDir}/source/main.bs`]
                });
                expect(
                    trim(result?.code)
                ).to.eql(trim`
                    sub main()
                        print "hello world"
                    end sub
                `);
                expect(result['pathAbsolute']).to.eql(result.srcPath);
            });

            it('calls beforeProgramTranspile and afterProgramTranspile plugin events', async () => {
                fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `
                    sub main()
                        print \`hello world\`
                    end sub
                `);
                fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, '');
                server.run();
                await server['syncProjects']();
                const afterSpy = sinon.spy();
                //make a plugin that changes string text
                server.projects[0].builder.program.plugins.add({
                    name: 'test-plugin',
                    beforeProgramTranspile: (program, entries, editor) => {
                        const file = program.getFile('source/main.bs');
                        if (isBrsFile(file)) {
                            file.ast.walk(createVisitor({
                                LiteralExpression: (expression) => {
                                    if (isLiteralString(expression)) {
                                        editor.setProperty(expression.token, 'text', 'hello moon');
                                    }
                                }
                            }), {
                                walkMode: WalkMode.visitAllRecursive
                            });
                        }
                    },
                    afterProgramTranspile: afterSpy
                });

                const result = await server.onExecuteCommand({
                    command: CustomCommands.TranspileFile,
                    arguments: [s`${rootDir}/source/main.bs`]
                });
                expect(
                    trim(result?.code)
                ).to.eql(trim`
                    sub main()
                        print "hello moon"
                    end sub
                `);
                expect(afterSpy.called).to.be.true;
            });
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
