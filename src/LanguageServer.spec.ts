import { expect } from './chai-config.spec';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import type { ConfigurationItem, DidChangeWatchedFilesParams, Location, PublishDiagnosticsParams, WorkspaceFolder } from 'vscode-languageserver';
import { FileChangeType } from 'vscode-languageserver';
import { Deferred } from './deferred';
import type { BrightScriptClientConfiguration } from './LanguageServer';
import { CustomCommands, LanguageServer } from './LanguageServer';
import { createSandbox } from 'sinon';
import { standardizePath as s, util } from './util';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Program } from './Program';
import * as assert from 'assert';
import type { PartialDiagnostic } from './testHelpers.spec';
import { createInactivityStub, expectZeroDiagnostics, normalizeDiagnostics, trim } from './testHelpers.spec';
import { isBrsFile, isLiteralString } from './astUtils/reflection';
import { createVisitor, WalkMode } from './astUtils/visitors';
import { tempDir, rootDir } from './testHelpers.spec';
import { URI } from 'vscode-uri';
import { BusyStatusTracker } from './BusyStatusTracker';
import type { BscFile } from './interfaces';
import type { Project } from './lsp/Project';
import { LogLevel, Logger, createLogger } from './logging';
import { DiagnosticMessages } from './DiagnosticMessages';
import { standardizePath } from 'roku-deploy';
import undent from 'undent';
import { ProjectManager } from './lsp/ProjectManager';
import type { WorkspaceConfig } from './lsp/ProjectManager';

const sinon = createSandbox();

const workspacePath = rootDir;
const enableThreadingDefault = LanguageServer.enableThreadingDefault;

describe('LanguageServer', () => {
    let server: LanguageServer;
    let program: Program;

    let workspaceFolders: string[] = [];

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
            },
            onDidChangeWorkspaceFolders: () => { }
        },
        tracer: {
            log: () => { }
        },
        client: {
            register: () => Promise.resolve()
        }
    };

    beforeEach(() => {
        sinon.restore();
        fsExtra.emptyDirSync(tempDir);

        server = new LanguageServer();
        server['busyStatusTracker'] = new BusyStatusTracker();
        workspaceFolders = [workspacePath];
        LanguageServer.enableThreadingDefault = false;

        //mock the connection stuff
        sinon.stub(server as any, 'establishConnection').callsFake(() => {
            return connection;
        });
        server['hasConfigurationCapability'] = true;
    });

    afterEach(() => {
        sinon.restore();
        fsExtra.emptyDirSync(tempDir);

        server['dispose']();
        LanguageServer.enableThreadingDefault = enableThreadingDefault;
    });

    function addXmlFile(name: string, additionalXmlContents = '') {
        const filePath = `components/${name}.xml`;

        const contents = `<?xml version="1.0" encoding="utf-8"?>
        <component name="${name}" extends="Group">
            ${additionalXmlContents}
            <script type="text/brightscript" uri="${name}.brs" />
        </component>`;
        return program.setFile(filePath, contents);
    }

    function addScriptFile(name: string, contents: string, extension = 'brs') {
        const filePath = s`components/${name}.${extension}`;
        const file = program.setFile(filePath, contents);
        if (file) {
            const document = TextDocument.create(util.pathToUri(file.srcPath), 'brightscript', 1, contents);
            (server['documents']['_syncedDocuments'] as Map<string, TextDocument>).set(document.uri, document);
            return document;
        }
    }

    it('does not cause infinite loop of project creation', async () => {
        //add a project with a files array that includes (and then excludes) a file
        fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, JSON.stringify({
            files: ['source/**/*', '!source/**/*.spec.bs']
        }));

        server['run']();

        function setSyncedDocument(srcPath: string, text: string, version = 1) {
            //force an open text document
            const document = TextDocument.create(util.pathToUri(
                util.standardizePath(srcPath
                )
            ), 'brightscript', 1, `sub main()\nend sub`);
            (server['documents']['_syncedDocuments'] as Map<string, TextDocument>).set(document.uri, document);
        }

        //wait for the projects to finish loading up
        await server['syncProjects']();

        //this bug was causing an infinite async loop of new project creations. So monitor the creation of new projects for evaluation later
        const { stub, promise: createProjectsSettled } = createInactivityStub(ProjectManager.prototype as any, 'constructProject', 400, sinon);

        setSyncedDocument(s`${rootDir}/source/lib1.spec.bs`, 'sub lib1()\nend sub');
        setSyncedDocument(s`${rootDir}/source/lib2.spec.bs`, 'sub lib2()\nend sub');

        // open a file that is excluded by the project, so it should trigger a standalone project.
        await server['onTextDocumentDidChangeContent']({
            document: TextDocument.create(util.pathToUri(s`${rootDir}/source/lib1.spec.bs`), 'brightscript', 1, `sub main()\nend sub`)
        });

        //wait for the "create projects" deferred debounce to settle
        await createProjectsSettled;

        //test passes if we've only made 2 new projects (one for each of the standalone projects)
        expect(stub.callCount).to.eql(2);
    });

    describe('onDidChangeConfiguration', () => {
        async function doTest(startingConfigs: WorkspaceConfig[], endingConfigs: WorkspaceConfig[]) {
            (server as any)['connection'] = connection;
            server['workspaceConfigsCache'] = new Map(startingConfigs.map(x => [x.workspaceFolder, x]));

            const stub = sinon.stub(server as any, 'getWorkspaceConfigs').returns(Promise.resolve(endingConfigs));

            await server.onDidChangeConfiguration({ settings: {} });
            stub.restore();
        }

        it('does not reload project when: no projects are present before and after', async () => {
            const stub = sinon.stub(server as any, 'syncProjects').callsFake(() => Promise.resolve());
            await doTest([], []);
            expect(stub.called).to.be.false;
        });

        it('does not reload project when: 1 project is unchanged', async () => {
            const stub = sinon.stub(server as any, 'syncProjects').callsFake(() => Promise.resolve());
            await doTest([{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }], [{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }]);
            expect(stub.called).to.be.false;
        });

        it('reloads project when adding new project', async () => {
            const stub = sinon.stub(server as any, 'syncProjects').callsFake(() => Promise.resolve());
            await doTest([], [{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }]);
            expect(stub.called).to.be.true;
        });

        it('reloads project when deleting a project', async () => {
            const stub = sinon.stub(server as any, 'syncProjects').callsFake(() => Promise.resolve());
            await doTest([{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }, {
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: s`${tempDir}/project2`,
                excludePatterns: []
            }], [{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }]);
            expect(stub.called).to.be.true;
        });

        it('reloads project when changing specific settings', async () => {
            const stub = sinon.stub(server as any, 'syncProjects').callsFake(() => Promise.resolve());
            await doTest([{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'trace'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }], [{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: workspacePath,
                excludePatterns: []
            }]);
            expect(stub.called).to.be.true;
        });

    });

    describe('sendDiagnostics', () => {
        it('dedupes diagnostics found at same location from multiple projects', async () => {
            fsExtra.outputFileSync(s`${rootDir}/common/lib.brs`, `
                sub test()
                    print alpha 'variable does not exist
                end sub
            `);
            fsExtra.outputFileSync(s`${rootDir}/project1/bsconfig.json`, JSON.stringify({
                rootDir: s`${rootDir}/project1`,
                files: [{
                    src: `../common/lib.brs`,
                    dest: 'source/lib.brs'
                }]
            }));
            fsExtra.outputFileSync(s`${rootDir}/project2/bsconfig.json`, JSON.stringify({
                rootDir: s`${rootDir}/project2`,
                files: [{
                    src: `../common/lib.brs`,
                    dest: 'source/lib.brs'
                }]
            }));

            server['connection'] = connection as any;
            let sendDiagnosticsDeferred = new Deferred<any>();
            let stub = sinon.stub(server['connection'], 'sendDiagnostics').callsFake(async (arg) => {
                sendDiagnosticsDeferred.resolve(arg);
                return sendDiagnosticsDeferred.promise;
            });

            await server['syncProjects']();

            await sendDiagnosticsDeferred.promise;

            expect(stub.getCall(0).args?.[0]?.diagnostics).to.be.lengthOf(1);
        });
    });

    describe('project-activate', () => {
        it('should sync all open document changes to all projects', async () => {

            //force an open text document
            const srcPath = s`${rootDir}/source/main.brs`;
            const document = TextDocument.create(util.pathToUri(srcPath), 'brightscript', 1, `sub main()\nend sub`);
            (server['documents']['_syncedDocuments'] as Map<string, TextDocument>).set(document.uri, document);

            const deferred = new Deferred();
            const stub = sinon.stub(server['projectManager'], 'handleFileChanges').callsFake(() => {
                deferred.resolve();
                return Promise.resolve();
            });

            server['projectManager']['emit']('project-activate', {
                project: server['projectManager'].projects[0]
            });

            await deferred.promise;
            expect(
                stub.getCalls()[0].args[0].map(x => ({
                    srcPath: x.srcPath,
                    fileContents: x.fileContents
                }))
            ).to.eql([{
                srcPath: srcPath,
                fileContents: document.getText()
            }]);
        });

        it('handles when there were no open documents', () => {
            server['projectManager']['emit']('project-activate', {
                project: {
                    projectNumber: 1
                }
            } as any);
            //we can't really test this, but it helps with code coverage...
        });
    });

    describe('syncProjects', () => {
        it('loads workspace as project', async () => {
            server.run();

            expect(server['projectManager'].projects).to.be.lengthOf(0);

            fsExtra.ensureDirSync(workspacePath);

            await server['syncProjects']();

            //no child bsconfig.json files, use the workspacePath
            expect(
                server['projectManager'].projects.map(x => x.projectKey)
            ).to.eql([
                workspacePath
            ]);

            fsExtra.outputJsonSync(s`${workspacePath}/project1/bsconfig.json`, {});
            fsExtra.outputJsonSync(s`${workspacePath}/project2/bsconfig.json`, {});

            await server['syncProjects']();

            //2 child bsconfig.json files. Use those folders as projects, and don't use workspacePath
            expect(
                server['projectManager'].projects.map(x => x.projectKey).sort()
            ).to.eql([
                s`${workspacePath}/project1/bsconfig.json`,
                s`${workspacePath}/project2/bsconfig.json`
            ]);

            fsExtra.removeSync(s`${workspacePath}/project2/bsconfig.json`);
            await server['syncProjects']();

            //1 child bsconfig.json file. Still don't use workspacePath
            expect(
                server['projectManager'].projects.map(x => x.projectKey)
            ).to.eql([
                s`${workspacePath}/project1/bsconfig.json`
            ]);

            fsExtra.removeSync(s`${workspacePath}/project1/bsconfig.json`);
            await server['syncProjects']();

            //back to no child bsconfig.json files. use workspacePath again
            expect(
                server['projectManager'].projects.map(x => x.projectKey)
            ).to.eql([
                workspacePath
            ]);
        });

        it('ignores bsconfig.json files from vscode ignored paths', async () => {
            const mapItem = (item: ConfigurationItem) => {
                if (item.section === 'files') {
                    return {
                        exclude: {
                            '**/vendor': true
                        }
                    };
                } else if (item.section === 'search') {
                    return {
                        exclude: {
                            '**/temp': true
                        }
                    };
                } else {
                    return {};
                }
            };

            server.run();
            sinon.stub(server['connection'].workspace, 'getConfiguration').callsFake(
                // @ts-expect-error Sinon incorrectly infers the type of this function
                (items: any) => {
                    if (typeof items === 'string') {
                        return Promise.resolve({});
                    }
                    if (Array.isArray(items)) {
                        return Promise.resolve(items.map(mapItem));
                    }
                    return Promise.resolve(mapItem(items));
                }
            );
            await server.onInitialized();

            fsExtra.outputJsonSync(s`${workspacePath}/vendor/someProject/bsconfig.json`, {});
            fsExtra.outputJsonSync(s`${workspacePath}/temp/someProject/bsconfig.json`, {});
            //it always ignores node_modules
            fsExtra.outputJsonSync(s`${workspacePath}/node_modules/someProject/bsconfig.json`, {});
            await server['syncProjects']();

            //no child bsconfig.json files, use the workspacePath
            expect(
                server['projectManager'].projects.map(x => x.projectKey)
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
                server['projectManager'].projects.map(x => x.projectKey).sort()
            ).to.eql([
                s`${tempDir}/root/bsconfig.json`,
                s`${tempDir}/root/subdir/bsconfig.json`
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
                server['projectManager'].projects.map(x => x.projectKey).sort()
            ).to.eql([
                s`${tempDir}/project1`,
                s`${tempDir}/sub/dir/project2`
            ]);
        });

        it('uses explicit projects list', async () => {
            fsExtra.outputJsonSync(s`${tempDir}/project1/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${tempDir}/project1/source/main.brs`, '');

            fsExtra.outputJsonSync(s`${tempDir}/sub/dir/project2/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${tempDir}/sub/dir/project2/source/main.bs`, '');

            //not in projects list
            fsExtra.outputJsonSync(s`${tempDir}/project3/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${tempDir}/project3/source/main.brs`, '');

            workspaceFolders = [
                s`${tempDir}/`
            ];
            const workspaceSettings: BrightScriptClientConfiguration = {
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                projects: [
                    // eslint-disable-next-line no-template-curly-in-string
                    'project1',
                    // eslint-disable-next-line no-template-curly-in-string
                    '${workspaceFolder}/sub/dir/project2/bsconfig.json',
                    // eslint-disable-next-line no-template-curly-in-string
                    { name: 'p3', path: '${workspaceFolder}/project3', disabled: true }
                ]
            };

            server.run();

            sinon.stub(server as any, 'getClientConfiguration').returns(Promise.resolve(workspaceSettings));

            expect(
                await server['getWorkspaceConfigs']()
            ).to.eql([
                {
                    workspaceFolder: s`${tempDir}/`,
                    excludePatterns: [],
                    projects: [
                        { path: 'project1' },
                        { path: s`${tempDir}/sub/dir/project2/bsconfig.json` },
                        { name: 'p3', path: s`${tempDir}/project3`, disabled: true }
                    ],
                    languageServer: {
                        enableThreading: false,
                        enableProjectDiscovery: true,
                        projectDiscoveryMaxDepth: 15,
                        projectDiscoveryExclude: undefined,
                        logLevel: 'info'
                    }
                }
            ]);
        });
    });

    describe('projectDiscoveryExclude and files.watcherExclude', () => {
        it('includes projectDiscoveryExclude in workspace configuration', async () => {
            const projectDiscoveryExclude = ['**/test/**', 'node_modules/**'];

            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                if (section === 'brightscript') {
                    return Promise.resolve({
                        languageServer: {
                            projectDiscoveryExclude: projectDiscoveryExclude
                        }
                    });
                }
                return Promise.resolve({});
            });

            server.run();
            const configs = await server['getWorkspaceConfigs']();
            expect(configs[0].languageServer.projectDiscoveryExclude).to.deep.equal(projectDiscoveryExclude);
        });

        it('includes files.watcherExclude in workspace exclude patterns', async () => {
            const watcherExclude = {
                '**/tmp/**': true,
                '**/cache/**': true
            };

            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                if (section === 'files') {
                    return Promise.resolve({
                        exclude: { 'node_modules': true },
                        watcherExclude: watcherExclude
                    });
                }
                return Promise.resolve({});
            });

            server.run();
            const excludeGlobs = await server['getWorkspaceExcludeGlobs'](workspaceFolders[0]);
            expect(excludeGlobs).to.include('**/tmp/**');
            expect(excludeGlobs).to.include('**/cache/**');
        });

        it('handles undefined projectDiscoveryExclude without crashing', async () => {
            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                if (section === 'brightscript') {
                    return Promise.resolve({
                        languageServer: {
                            // projectDiscoveryExclude is undefined
                        }
                    });
                }
                return Promise.resolve({});
            });

            server.run();
            const configs = await server['getWorkspaceConfigs']();
            expect(configs[0].languageServer.projectDiscoveryExclude).to.be.undefined;
            
            // Should not crash during pathFilterer rebuild
            await server['rebuildPathFilterer']();
        });

        it('handles undefined files.watcherExclude without crashing', async () => {
            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                if (section === 'files') {
                    return Promise.resolve({
                        exclude: { 'node_modules': true }
                        // watcherExclude is undefined
                    });
                }
                return Promise.resolve({});
            });

            server.run();
            const excludeGlobs = await server['getWorkspaceExcludeGlobs'](workspaceFolders[0]);
            expect(excludeGlobs).to.be.an('array');
            expect(excludeGlobs).to.include('node_modules');
        });

        it('handles null/undefined configuration sections without crashing', async () => {
            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                return Promise.resolve(null);
            });

            server.run();
            const configs = await server['getWorkspaceConfigs']();
            expect(configs[0].languageServer.projectDiscoveryExclude).to.be.undefined;
            
            const excludeGlobs = await server['getWorkspaceExcludeGlobs'](workspaceFolders[0]);
            expect(excludeGlobs).to.be.an('array');
            expect(excludeGlobs).to.be.empty;
        });

        it('handles empty objects for configuration sections without crashing', async () => {
            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                return Promise.resolve({});
            });

            server.run();
            const configs = await server['getWorkspaceConfigs']();
            expect(configs[0].languageServer.projectDiscoveryExclude).to.be.undefined;
            
            const excludeGlobs = await server['getWorkspaceExcludeGlobs'](workspaceFolders[0]);
            expect(excludeGlobs).to.be.an('array');
            expect(excludeGlobs).to.be.empty;
        });

        it('handles mixed defined/undefined settings without crashing', async () => {
            sinon.stub(server as any, 'getClientConfiguration').callsFake((workspaceFolder, section) => {
                if (section === 'brightscript') {
                    return Promise.resolve({
                        languageServer: {
                            projectDiscoveryExclude: ['**/test/**']
                        }
                    });
                } else if (section === 'files') {
                    return Promise.resolve({
                        exclude: { 'node_modules': true }
                        // watcherExclude is undefined
                    });
                }
                return Promise.resolve({});
            });

            server.run();
            const configs = await server['getWorkspaceConfigs']();
            expect(configs[0].languageServer.projectDiscoveryExclude).to.deep.equal(['**/test/**']);
            
            const excludeGlobs = await server['getWorkspaceExcludeGlobs'](workspaceFolders[0]);
            expect(excludeGlobs).to.be.an('array');
            expect(excludeGlobs).to.include('node_modules');
            
            // Should not crash during pathFilterer rebuild
            await server['rebuildPathFilterer']();
        });
    });

    describe('onInitialize', () => {
        it('sets capabilities', async () => {
            server['hasConfigurationCapability'] = false;
            server['clientHasWorkspaceFolderCapability'] = false;

            await server.onInitialize({
                capabilities: {
                    workspace: {
                        configuration: true,
                        workspaceFolders: true
                    }
                }
            } as any);
            expect(server['hasConfigurationCapability']).to.be.true;
            expect(server['clientHasWorkspaceFolderCapability']).to.be.true;
        });
    });

    describe('onInitialized', () => {
        it('registers workspaceFolders change listener', async () => {

            server['connection'] = connection as any;

            const deferred = new Deferred();
            sinon.stub(server['connection']['workspace'], 'onDidChangeWorkspaceFolders').callsFake((() => {
                deferred.resolve();
            }) as any);

            server['hasConfigurationCapability'] = false;
            server['clientHasWorkspaceFolderCapability'] = true;

            await server.onInitialized();
            //if the promise resolves, we know the function was called
            await deferred.promise;
        });
    });

    describe('syncLogLevel', () => {
        beforeEach(() => {
            //disable logging for these tests
            sinon.stub(Logger.prototype, 'write').callsFake(() => { });
        });

        it('uses a default value when no workspace or projects are present', async () => {
            server.run();
            await server['syncLogLevel']();
            expect(server.logger.logLevel).to.eql(LogLevel.log);
        });

        it('recovers when workspace sends unsupported value', async () => {
            server.run();

            sinon.stub(server as any, 'getClientConfiguration').returns(Promise.resolve({
                languageServer: {
                    logLevel: 'not-valid'
                }
            }));
            await server['syncLogLevel']();
            expect(server.logger.logLevel).to.eql(LogLevel.log);
        });

        it('uses logLevel from workspace', async () => {
            server.run();

            sinon.stub(server as any, 'getClientConfiguration').returns(Promise.resolve({
                languageServer: {
                    logLevel: 'trace'
                }
            }));
            await server['syncLogLevel']();
            expect(server.logger.logLevel).to.eql(LogLevel.trace);
        });

        it('uses the higher-verbosity logLevel from multiple workspaces', async () => {
            server.run();

            //mock multiple workspaces
            sinon.stub(server['connection'].workspace, 'getWorkspaceFolders').returns(Promise.resolve([
                {
                    name: 'workspace1',
                    uri: getFileProtocolPath(s`${tempDir}/project1`)
                },
                {
                    name: 'workspace1',
                    uri: getFileProtocolPath(s`${tempDir}/project2`)
                }
            ]));

            sinon.stub(server as any, 'getClientConfiguration').onFirstCall().returns(Promise.resolve({
                languageServer: {
                    logLevel: 'trace'
                }
            })).onSecondCall().returns(Promise.resolve({
                languageServer: {
                    logLevel: 'info'
                }
            }));
            await server['syncLogLevel']();

            expect(server.logger.logLevel).to.eql(LogLevel.trace);
        });

        it('uses valid workspace value when one of them is invalid', async () => {
            server.run();

            //mock multiple workspaces
            sinon.stub(server['connection'].workspace, 'getWorkspaceFolders').returns(Promise.resolve([
                {
                    name: 'workspace1',
                    uri: getFileProtocolPath(s`${tempDir}/project1`)
                },
                {
                    name: 'workspace1',
                    uri: getFileProtocolPath(s`${tempDir}/project2`)
                }
            ]));

            sinon.stub(server as any, 'getClientConfiguration').onFirstCall().returns(Promise.resolve({
                languageServer: {
                    logLevel: 'trace1'
                }
            })).onSecondCall().returns(Promise.resolve({
                languageServer: {
                    logLevel: 'info'
                }
            }));
            await server['syncLogLevel']();

            expect(server.logger.logLevel).to.eql(LogLevel.info);
        });

        it('uses value from projects when not found in workspace', async () => {
            server.run();

            //mock multiple workspaces
            sinon.stub(server['connection'].workspace, 'getWorkspaceFolders').returns(Promise.resolve([{
                name: 'workspace1',
                uri: getFileProtocolPath(s`${tempDir}/project2`)
            }]));

            server['projectManager'].projects.push({
                logger: createLogger({
                    logLevel: LogLevel.info
                }),
                projectNumber: 2
            } as any);

            await server['syncLogLevel']();

            expect(server.logger.logLevel).to.eql(LogLevel.info);
        });
    });

    describe('rebuildPathFilterer', () => {
        let workspaceConfigs: WorkspaceConfig[] = [];
        beforeEach(() => {
            workspaceConfigs = [
                {
                    languageServer: {
                        enableThreading: false,
                        enableProjectDiscovery: true,
                        logLevel: 'info'
                    },
                    workspaceFolder: workspacePath,
                    excludePatterns: []
                }
            ];
            server['connection'] = connection as any;
            sinon.stub(server as any, 'getWorkspaceConfigs').callsFake(() => Promise.resolve(workspaceConfigs));
        });

        it('allows files from dist by default', async () => {
            const filterer = await server['rebuildPathFilterer']();
            //certain files are allowed through by default
            expect(
                filterer.filter([
                    s`${rootDir}/manifest`,
                    s`${rootDir}/dist/file.brs`,
                    s`${rootDir}/source/file.brs`
                ])
            ).to.eql([
                s`${rootDir}/manifest`,
                s`${rootDir}/dist/file.brs`,
                s`${rootDir}/source/file.brs`
            ]);
        });

        it('filters out some standard locations by default', async () => {
            const filterer = await server['rebuildPathFilterer']();

            expect(
                filterer.filter([
                    s`${workspacePath}/node_modules/file.brs`,
                    s`${workspacePath}/.git/file.brs`,
                    s`${workspacePath}/out/file.brs`,
                    s`${workspacePath}/.roku-deploy-staging/file.brs`
                ])
            ).to.eql([]);
        });

        it('properly handles a .gitignore list', async () => {
            fsExtra.outputFileSync(s`${workspacePath}/.gitignore`, undent`
                dist/
            `);

            const filterer = await server['rebuildPathFilterer']();

            //filters files that appear in a .gitignore list
            expect(
                filterer.filter([
                    s`${workspacePath}/src/source/file.brs`,
                    //this file should be excluded
                    s`${workspacePath}/dist/source/file.brs`
                ])
            ).to.eql([
                s`${workspacePath}/src/source/file.brs`
            ]);
        });

        it('does not crash for path outside of workspaceFolder', async () => {
            fsExtra.outputFileSync(s`${workspacePath}/.gitignore`, undent`
                dist/
            `);

            const filterer = await server['rebuildPathFilterer']();

            //filters files that appear in a .gitignore list
            expect(
                filterer.filter([
                    s`${workspacePath}/../flavor1/src/source/file.brs`
                ])
            ).to.eql([
                //since the path is outside the workspace, it does not match the .gitignore patter, and thus is not excluded
                s`${workspacePath}/../flavor1/src/source/file.brs`
            ]);
        });

        it('a gitignore file from any workspace will apply to all workspaces', async () => {
            workspaceConfigs = [{
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: s`${tempDir}/flavor1`,
                excludePatterns: []
            }, {
                languageServer: {
                    enableThreading: false,
                    enableProjectDiscovery: true,
                    logLevel: 'info'
                },
                workspaceFolder: s`${tempDir}/flavor2`,
                excludePatterns: []
            }];
            fsExtra.outputFileSync(s`${workspaceConfigs[0].workspaceFolder}/.gitignore`, undent`
                dist/
            `);
            fsExtra.outputFileSync(s`${workspaceConfigs[1].workspaceFolder}/.gitignore`, undent`
                out/
            `);

            const filterer = await server['rebuildPathFilterer']();

            //filters files that appear in a .gitignore list
            expect(
                filterer.filter([
                    //included files
                    s`${workspaceConfigs[0].workspaceFolder}/src/source/file.brs`,
                    s`${workspaceConfigs[1].workspaceFolder}/src/source/file.brs`,
                    //excluded files
                    s`${workspaceConfigs[0].workspaceFolder}/dist/source/file.brs`,
                    s`${workspaceConfigs[1].workspaceFolder}/out/source/file.brs`
                ])
            ).to.eql([
                s`${workspaceConfigs[0].workspaceFolder}/src/source/file.brs`,
                s`${workspaceConfigs[1].workspaceFolder}/src/source/file.brs`
            ]);
        });

        it('does not erase project-specific filters', async () => {
            let filterer = await server['rebuildPathFilterer']();
            const files = [
                s`${rootDir}/node_modules/one/file.xml`,
                s`${rootDir}/node_modules/two.bs`,
                s`${rootDir}/node_modules/three/dist/lib.bs`
            ];

            //all node_modules files are filtered out by default, unless included in an includeList
            expect(filterer.filter(files)).to.eql([]);

            //register two specific node_module folders to include
            filterer.registerIncludeList(rootDir, ['node_modules/one/**/*', 'node_modules/two.bs']);

            //unless included in an includeList
            expect(filterer.filter(files)).to.eql([
                s`${rootDir}/node_modules/one/file.xml`,
                s`${rootDir}/node_modules/two.bs`
                //three should still be excluded
            ]);

            //rebuild the path filterer, make sure the project's includeList is still retained
            filterer = await server['rebuildPathFilterer']();

            expect(filterer.filter(files)).to.eql([
                //one and two should still make it through the filter unscathed
                s`${rootDir}/node_modules/one/file.xml`,
                s`${rootDir}/node_modules/two.bs`
                //three should still be excluded
            ]);
        });

        it('a removed project includeList gets unregistered', async () => {
            let filterer = await server['rebuildPathFilterer']();
            const files = [
                s`${rootDir}/project1/node_modules/one/file.xml`,
                s`${rootDir}/project1/node_modules/two.bs`,
                s`${rootDir}/project1/node_modules/three/dist/lib.bs`
            ];

            //all node_modules files are filtered out by default, unless included in an includeList
            expect(filterer.filter(files)).to.eql([]);

            //register a new project that references a file from node_modules
            fsExtra.outputFileSync(s`${rootDir}/project1/bsconfig.json`, JSON.stringify({
                files: ['node_modules/one/file.xml']
            }));

            await server['syncProjects']();

            //one should be included because the project references it
            expect(filterer.filter(files)).to.eql([
                s`${rootDir}/project1/node_modules/one/file.xml`
            ]);

            //delete the project's bsconfig.json and sync again (thus destroying the project)
            fsExtra.removeSync(s`${rootDir}/project1/bsconfig.json`);

            await server['syncProjects']();

            //the project's pathFilterer pattern has been unregistered
            expect(filterer.filter(files)).to.eql([]);
        });
    });

    describe('onDidChangeWatchedFiles', () => {
        it('does not trigger revalidates when changes are in files which are not tracked', async () => {
            server.run();
            const externalDir = s`${tempDir}/not_app_dir`;
            fsExtra.outputJsonSync(s`${externalDir}/bsconfig.json`, {});
            fsExtra.outputFileSync(s`${externalDir}/source/main.brs`, '');
            fsExtra.outputFileSync(s`${externalDir}/source/lib.brs`, '');
            await server['syncProjects']();

            const stub2 = sinon.stub((server['projectManager'].projects[0] as Project)['builder'].program, 'setFile');

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

        it('rebuilds the path filterer when certain files are changed', async () => {

            sinon.stub(server['projectManager'], 'handleFileChanges').callsFake(() => Promise.resolve());
            (server as any)['connection'] = connection;
            async function test(filePath: string, expected = true) {
                const stub = sinon.stub(server as any, 'rebuildPathFilterer');

                await server['onDidChangeWatchedFiles']({
                    changes: [{
                        type: FileChangeType.Changed,
                        uri: util.pathToUri(filePath)
                    }]
                } as DidChangeWatchedFilesParams);

                expect(
                    stub.getCalls().length
                ).to.eql(expected ? 1 : 0);

                stub.restore();
            }

            await test(s`${rootDir}/bsconfig.json`);
            await test(s`${rootDir}/sub/dir/bsconfig.json`);

            await test(s`${rootDir}/.vscode/settings.json`);

            await test(s`${rootDir}/.gitignore`);
            await test(s`${rootDir}/sub/dir/.two/.gitignore`);

            await test(s`${rootDir}/source/main.brs`, false);
        });

        it('excludes explicit workspaceFolder paths', async () => {
            (server as any).connection = connection;
            sinon.stub(server['connection'].workspace, 'getWorkspaceFolders').returns(Promise.resolve([{
                name: 'workspace1',
                uri: util.pathToUri(s`${tempDir}/project1`)
            } as WorkspaceFolder]));

            const stub = sinon.stub(server['projectManager'], 'handleFileChanges').callsFake(() => Promise.resolve());

            await server['onDidChangeWatchedFiles']({
                changes: [{
                    type: FileChangeType.Created,
                    uri: util.pathToUri(s`${tempDir}/project1`)
                }]
            } as DidChangeWatchedFilesParams);

            //it did not send along the workspace folder itself
            expect(
                stub.getCalls()[0].args[0]
            ).to.eql([]);
        });
    });

    describe('onDocumentClose', () => {
        it('calls handleFileClose', async () => {
            const stub = sinon.stub(server['projectManager'], 'handleFileClose').callsFake((() => { }) as any);
            await server['onDocumentClose']({
                document: {
                    uri: util.pathToUri(s`${rootDir}/source/main.brs`)
                } as any
            });
            expect(stub.args[0][0].srcPath).to.eql(s`${rootDir}/source/main.brs`);
        });
    });

    describe('onSignatureHelp', () => {
        let callDocument: TextDocument;
        let importingXmlFile: BscFile;
        const functionFileBaseName = 'buildAwesome';
        const funcDefinitionLine = 'function buildAwesome(confirm = true as Boolean)';
        beforeEach(async () => {
            server['connection'] = server['establishConnection']();
            await server['syncProjects']();
            program = (server['projectManager'].projects[0] as Project)['builder'].program;

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
            `)!;
            importingXmlFile = addXmlFile(name, `<script type="text/brightscript" uri="${functionFileBaseName}.bs" />`);
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

        it('should return "null" as signature and parameter when used on something with no signature', async () => {
            const result = await server['onSignatureHelp']({
                textDocument: {
                    uri: importingXmlFile.pkgPath
                },
                position: util.createPosition(0, 5)
            });

            console.dir(result);

            expect(result.signatures.length).to.equal(0);
            expect(result.activeSignature).to.equal(null);
            expect(result.activeParameter).to.equal(null);
        });
    });

    describe('onCompletion', () => {
        it('does not crash when uri is invalid', async () => {
            sinon.stub(server['projectManager'], 'getCompletions').callsFake(() => Promise.resolve({ items: [], isIncomplete: false }));
            expect(
                await (server['onCompletion'] as any)({
                    textDocument: {
                        uri: 'invalid'
                    },
                    position: util.createPosition(0, 0)
                } as any)
            ).to.eql({
                items: [],
                isIncomplete: false
            });
        });
    });

    describe('onReferences', () => {
        let functionDocument: TextDocument;
        let referenceFileUris: string[] = [];

        beforeEach(async () => {
            server['connection'] = server['establishConnection']();
            await server['syncProjects']();
            program = (server['projectManager'].projects[0] as Project)['builder'].program;

            const functionFileBaseName = 'buildAwesome';
            functionDocument = addScriptFile(functionFileBaseName, `
                function buildAwesome()
                    return 42
                end function
            `)!;

            for (let i = 0; i < 5; i++) {
                let name = `CallComponent${i}`;
                const document = addScriptFile(name, `
                    sub init()
                        shouldBuildAwesome = true
                        if shouldBuildAwesome then
                            buildAwesome()
                        end if
                    end sub
                `)!;

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
            server['connection'] = server['establishConnection']();
            await server['syncProjects']();
            program = (server['projectManager'].projects[0] as Project)['builder'].program;

            const functionFileBaseName = 'buildAwesome';
            functionDocument = addScriptFile(functionFileBaseName, `
                function pi()
                    return 3.141592653589793
                end function

                function buildAwesome()
                    return 42
                end function
            `)!;

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
            `)!;

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
            `, 'bs')!;

            const name = `CallComponent`;
            referenceDocument = addScriptFile(name, `
                sub init()
                    build = new Build()
                    build.awesome()
                end sub
            `)!;

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
            server['connection'] = server['establishConnection']();
            await server['syncProjects']();
            program = (server['projectManager'].projects[0] as Project)['builder'].program;
        });

        it('should return the expected symbols even if pulled from cache', async () => {
            const document = addScriptFile('buildAwesome', `
                function pi()
                    return 3.141592653589793
                end function

                function buildAwesome()
                    return 42
                end function
            `)!;

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = (await server.onDocumentSymbol({
                    textDocument: document
                }))!;
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
            `, 'bs')!;

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = (await server['onDocumentSymbol']({
                    textDocument: document
                }))!;

                expect(symbols.length).to.equal(1);
                const classSymbol = symbols[0];
                expect(classSymbol.name).to.equal('MyFirstClass');
                const classChildrenSymbols = classSymbol.children!;
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
            `, 'bs')!;
            program.validate();

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = (await server['onDocumentSymbol']({
                    textDocument: document
                }))!;

                expect(symbols.length).to.equal(1);
                const namespaceSymbol = symbols[0];
                expect(namespaceSymbol.name).to.equal('MyFirstNamespace');
                const classChildrenSymbols = namespaceSymbol.children!;
                expect(classChildrenSymbols.length).to.equal(2);
                expect(classChildrenSymbols[0].name).to.equal('pi');
                expect(classChildrenSymbols[1].name).to.equal('buildAwesome');
            }
        });
    });

    describe('onWorkspaceSymbol', () => {
        beforeEach(async () => {
            server['connection'] = server['establishConnection']();
            await server['syncProjects']();
            program = (server['projectManager'].projects[0] as Project)['builder'].program;
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
            addScriptFile('nested', `
                namespace animals
                    class dog
                        function run()
                            return 3.141592653589793
                        end function

                        function speak()
                            return 42
                        end function
                    end class
                end namespace
            `, 'bs');
            program.validate();

            // We run the check twice as the first time is with it not cached and second time is with it cached
            for (let i = 0; i < 2; i++) {
                const symbols = await server['onWorkspaceSymbol']({} as any);
                expect(
                    symbols.map(x => ({
                        name: x.name,
                        containerName: x.containerName
                    })).sort((a, b) => a.name.localeCompare(b.name))
                ).to.eql([
                    { name: 'animals', containerName: undefined },
                    { name: `dog`, containerName: 'animals' },
                    { name: `run`, containerName: 'dog' },
                    { name: 'speak', containerName: 'dog' }
                ]);
            }
        });
    });

    describe('getClientConfiguration', () => {
        it('executes the connection.workspace.getConfiguration call when enabled to do so', async () => {
            server.run();
            sinon.restore();

            sinon.stub(server['connection'].workspace, 'getConfiguration').returns(Promise.resolve({ configFile: 'something.json' }) as any);
            server['hasConfigurationCapability'] = true;
            expect(
                await server['getClientConfiguration'](workspacePath, 'brightscript')
            ).to.eql({
                configFile: 'something.json'
            });
        });

        it('skips the connection.workspace.getConfiguration call when not supported', async () => {
            server.run();
            sinon.restore();

            const stub = sinon.stub(server['connection'].workspace, 'getConfiguration').returns(Promise.resolve({ configFile: 'something.json' }) as any);
            server['hasConfigurationCapability'] = false;
            await server['getClientConfiguration'](workspacePath, 'brightscript');
            expect(stub.called).to.be.false;
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
                const result = (await server.onExecuteCommand({
                    command: CustomCommands.TranspileFile,
                    arguments: [s`${rootDir}/source/main.bs`]
                }))!;
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
                (server['projectManager'].projects[0] as Project)['builder'].program.plugins.add({
                    name: 'test-plugin',
                    beforeProgramTranspile: (program, entries, editor) => {
                        const file = program.getFile('source/main.bs')!;
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

                const result = (await server.onExecuteCommand({
                    command: CustomCommands.TranspileFile,
                    arguments: [s`${rootDir}/source/main.bs`]
                }))!;
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

    it('semantic tokens request waits until after validation has finished', async () => {
        fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `
            sub main()
                print \`hello world\`
            end sub
        `);
        let spaceCount = 0;
        const getContents = () => {
            return `
                namespace sgnode
                    sub speak(message)
                        print message
                    end sub

                    sub sayHello()
                        sgnode.speak("Hello")${' '.repeat(spaceCount++)}
                    end sub
                end namespace
            `;
        };

        const uri = URI.file(s`${rootDir}/source/sgnode.bs`).toString();

        fsExtra.outputFileSync(s`${rootDir}/source/sgnode.bs`, getContents());
        server.run();
        await server['syncProjects']();
        expectZeroDiagnostics((server['projectManager'].projects[0] as Project)['builder'].program);

        fsExtra.outputFileSync(s`${rootDir}/source/sgnode.bs`, getContents());
        const changeWatchedFilesPromise = server['onDidChangeWatchedFiles']({
            changes: [{
                type: FileChangeType.Changed,
                uri: uri
            }]
        });
        const document = {
            getText: () => getContents(),
            uri: uri
        } as TextDocument;

        const semanticTokensPromise = server['onFullSemanticTokens']({
            textDocument: document
        });
        await Promise.all([
            changeWatchedFilesPromise,
            semanticTokensPromise
        ]);
        expectZeroDiagnostics((server['projectManager'].projects[0] as Project)['builder'].program);
    });

    describe('sendDiagnostics', () => {
        let diagnostics = {};
        let diagnosticsDeferred = new Deferred();

        beforeEach(() => {
            server['connection'] = connection as any;
            sinon.stub(Logger.prototype, 'write').callsFake(() => {
                //do nothing, logging is too noisy
            });

            diagnosticsDeferred = new Deferred();

            let timer = setTimeout(() => { }, 0);
            sinon.stub(server['connection'], 'sendDiagnostics').callsFake((params: PublishDiagnosticsParams) => {
                clearTimeout(timer);
                if (params.diagnostics.length === 0) {
                    delete diagnostics[params.uri];
                } else {
                    diagnostics[params.uri] = params.diagnostics;
                }
                //debounce the promise so we get the final snapshot of diagnostics sent
                timer = setTimeout(() => {
                    diagnosticsDeferred.resolve();
                    diagnosticsDeferred = new Deferred();
                }, 100);
                return Promise.resolve();
            });
        });

        async function diagnosticsEquals(expectedDiagnostics: Record<string, Array<PartialDiagnostic | string | number>>) {
            //wait for a patch
            await diagnosticsDeferred.promise;

            let actualDiagnostics = { ...diagnostics };

            //normalize the keys
            for (let collection of [actualDiagnostics, expectedDiagnostics]) {
                //convert a URI-like string to an fsPath
                for (let key in collection) {
                    let keyNormalized = key.startsWith('file:') ? URI.parse(key).fsPath : key;
                    keyNormalized = standardizePath(
                        path.isAbsolute(keyNormalized) ? keyNormalized : s`${rootDir}/${keyNormalized}`
                    );
                    //if we changed the key, replace this in the collection
                    if (keyNormalized !== key) {
                        collection[keyNormalized] = collection[key];
                        delete collection[key];
                    }
                }
            }

            //normalize the actual diagnostics so it has diagnostics in the same format as the expected
            for (let key in actualDiagnostics) {
                const [actual, expected] = normalizeDiagnostics(actualDiagnostics[key], expectedDiagnostics[key] ?? []);
                actualDiagnostics[key] = actual;
                expectedDiagnostics[key] = expected;
            }
            expect(actualDiagnostics).to.eql(expectedDiagnostics);
        }

        it('clears standalone file project diagnostics when that file is adopted by at least one project', async () => {
            const projectManager = server['projectManager'];
            const documentManager = projectManager['documentManager'];

            //force instant document flushes
            documentManager['options'].delay = 0;

            //build a small functional project
            fsExtra.outputFileSync(`${rootDir}/source/main.bs`, `
                sub main()
                    alpha.beta()
                    print missing
                end sub
            `);
            fsExtra.outputFileSync(`${rootDir}/source/lib.bs`, `
                    namespace alpha
                    sub beta()
                    end sub
                end namespace
            `);
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, `
                {
                    "files": ["source/**/*.bs"],
                    //silence the logger, it's noisy
                    "logLevel": "error"
                }
            `);
            server.run();

            await server['onInitialized']();

            await diagnosticsEquals({
                'source/main.bs': [
                    DiagnosticMessages.cannotFindName('missing').message
                ]
            });

            const document = TextDocument.create(
                URI.file(s`${rootDir}/source/main.bs`).toString(),
                'brightscript',
                0, `
                    sub main()
                        alpha.beta()
                        print missing2
                    end sub
                `
            );
            //open the main.bs file so it gets reloaded in a standalone project
            server['documents'].all = () => [document];

            await server['onTextDocumentDidChangeContent']({
                document: document
            });

            await diagnosticsEquals({
                'source/main.bs': [
                    DiagnosticMessages.cannotFindName('missing2').message
                ]
            });

            //mangle the bsconfig and then sync the project. this should produce new diagnostics from the file as it's now in a standalone project
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, `
                    {
                        "files": ["source/lib.bs"]
                //missing closing curly brace (and also have a comma, oops
            `);

            //tell the language server we've changed a bsconfig. it'll reload the file (fail cuz syntax error) and create a standalone project for the opened file
            await server['onDidChangeWatchedFiles']({
                changes: [{
                    type: FileChangeType.Changed,
                    uri: URI.file(`${rootDir}/bsconfig.json`).toString()
                }]
            });

            //wait for the manager to settle
            await projectManager.onIdle();

            //we should get a patch clearing the diagnostics from the unloaded main project, then
            //when the standalone project finishes loading, we should get another diagnostics patch, then
            //when the project activates, we flush open document changes. So now the opened copy of the file is re-processed and we get the correct error message `missing2`
            await diagnosticsEquals({
                'source/main.bs': [
                    DiagnosticMessages.cannotFindName('alpha').message,
                    DiagnosticMessages.cannotFindName('missing2').message
                ],
                'bsconfig.json': [
                    'Encountered syntax errors in bsconfig.json: CloseBraceExpected'
                ]
            });


            //now fix the bsconfig and sync again. This should dispose the standalone project and send new diagnostics
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, `
                {
                    "files": ["source/**/*.bs"],
                    //silence the logger, it's noisy
                    "logLevel": "error"
                }
            `);

            //tell the language server we've changed a bsconfig
            await server['onDidChangeWatchedFiles']({
                changes: [{
                    type: FileChangeType.Changed,
                    uri: URI.file(`${rootDir}/bsconfig.json`).toString()
                }]
            });

            //let the manager settle
            await projectManager.onIdle();

            //and then get more diagnostics when the opened file is parsed as well
            await diagnosticsEquals({
                'source/main.bs': [
                    DiagnosticMessages.cannotFindName('missing2').message
                ]
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
