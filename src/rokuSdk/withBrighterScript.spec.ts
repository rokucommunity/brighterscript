import { expect } from '../chai-config.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';
import { tempDir, trim } from '../testHelpers.spec';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { RokuSdkBrighterScriptOptions, RokuSdkBuildConfig, RokuSdkBuildResult, RokuSdkConfig } from './withBrighterScript';
import { createRokuSdkBrighterScriptPlugin, getRokuSdkBundleDir, getRokuSdkStaticAssetsDir, withBrighterScript } from './withBrighterScript';

describe('withBrighterScript (Roku RSG SDK integration)', () => {
    const projectRoot = s`${tempDir}/rkApp`;
    const pkgDir = s`${projectRoot}/pkg`;
    const bundleDir = s`${projectRoot}/dist-dev/bundle`;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
    });
    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
    });

    /**
     * Write a file into the app's static folder (`pkg/`)
     */
    function writePkgFile(pkgPath: string, contents: string) {
        fsExtra.outputFileSync(s`${pkgDir}/${pkgPath}`, contents);
    }

    /**
     * Do what rk does before the BrighterScript plugin's turn: copy pkg/ into the bundle as-is
     */
    function stageBundle() {
        fsExtra.copySync(pkgDir, bundleDir);
    }

    /**
     * Run the plugin's onEnd the way esbuild would, and return the (possibly modified) build result
     */
    async function runPlugin(options?: RokuSdkBrighterScriptOptions, result: RokuSdkBuildResult = { errors: [], warnings: [] }, config: RokuSdkBuildConfig = { rootDir: projectRoot }) {
        const plugin = createRokuSdkBrighterScriptPlugin(() => config, 'startDev', options);
        let onEnd: (result: RokuSdkBuildResult) => void | Promise<void>;
        await plugin.setup({
            onEnd: (callback) => {
                onEnd = callback;
            }
        });
        await onEnd(result);
        return result;
    }

    function readBundleFile(bundlePath: string) {
        return fsExtra.readFileSync(s`${bundleDir}/${bundlePath}`).toString();
    }

    describe('plugin', () => {
        it('transpiles BrighterScript in the staged bundle in place', async () => {
            writePkgFile('manifest', 'title=RkApp\nbuild_version=00042');
            writePkgFile('source/main.bs', trim`
                sub main()
                    print \`hello \${"world"}\`
                end sub
            `);
            writePkgFile('components/Hero.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Hero" extends="Group">
                    <script type="text/brightscript" uri="Hero.bs" />
                </component>
            `);
            writePkgFile('components/Hero.bs', trim`
                sub init()
                    m.top.id = m.top.id ?? "hero"
                end sub
            `);
            writePkgFile('images/logo.png', 'not really a png');
            stageBundle();
            //rk writes the final manifest before this plugin runs; it must survive untouched
            fsExtra.outputFileSync(s`${bundleDir}/manifest`, 'title=RkApp\nbuild_version=00042\nts_path=written-by-rk');

            const result = await runPlugin();

            expect(result.errors).to.eql([]);
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.bs`)).to.be.false;
            expect(fsExtra.pathExistsSync(s`${bundleDir}/components/Hero.bs`)).to.be.false;
            expect(readBundleFile('source/main.brs')).to.include('"hello "').and.not.include('`');
            expect(readBundleFile('components/Hero.brs')).to.include('m.top.id = ').and.not.include('??');
            expect(readBundleFile('components/Hero.xml')).to.include('uri="Hero.brs"');
            expect(readBundleFile('components/Hero.xml')).to.include('uri="pkg:/source/bslib.brs"');
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/bslib.brs`)).to.be.true;
            expect(readBundleFile('manifest')).to.include('ts_path=written-by-rk');
            expect(readBundleFile('images/logo.png')).to.eql('not really a png');
            //the static folder itself is never modified
            expect(fsExtra.pathExistsSync(s`${pkgDir}/source/main.bs`)).to.be.true;
        });

        it('validates against components rk generated outside the static folder', async () => {
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="BaseAppScene">
                    <script type="text/brightscript" uri="MainScene.bs" />
                </component>
            `);
            writePkgFile('components/MainScene.bs', `sub init()\nend sub`);
            stageBundle();
            //rk copies components compiled from TypeScript (i.e. `src/compiled-components`) into the bundle
            fsExtra.outputFileSync(s`${bundleDir}/components/BaseAppScene.xml`, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="BaseAppScene" extends="Scene">
                </component>
            `);

            const result = await runPlugin();

            expect(result.errors).to.eql([]);
            expect(readBundleFile('components/MainScene.xml')).to.include('uri="MainScene.brs"');
        });

        it('reports errors against the static folder and leaves the bundle alone', async () => {
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('source/main.bs', trim`
                sub main()
                    doesNotExist()
                end sub
            `);
            stageBundle();

            const result = await runPlugin();

            expect(result.errors).to.have.lengthOf(1);
            expect(result.errors[0]).to.include({
                id: DiagnosticMessages.cannotFindFunction('doesNotExist').code,
                pluginName: 'brighterscript'
            });
            expect(result.errors[0].text).to.include('doesNotExist');
            expect(result.errors[0].location).to.eql({
                file: s`${pkgDir}/source/main.bs`,
                line: 2,
                column: 4
            });
            //nothing was transpiled, so rk's later steps (which skip on errors) never see a half-built bundle
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.bs`)).to.be.true;
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.brs`)).to.be.false;
        });

        it('keeps the bundle path for diagnostics in files that are not in the static folder', async () => {
            writePkgFile('manifest', 'title=RkApp');
            stageBundle();
            fsExtra.outputFileSync(s`${bundleDir}/source/generated.bs`, `sub generated()\n    doesNotExist()\nend sub`);

            const result = await runPlugin();

            expect(result.errors.map(x => x.location?.file)).to.eql([
                s`${bundleDir}/source/generated.bs`
            ]);
        });

        it('reports warnings as warnings unless warningsAsErrors is set', async () => {
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('source/main.bs', `sub main()\n    doesNotExist()\nend sub`);
            const bsConfig = {
                diagnosticSeverityOverrides: {
                    [DiagnosticMessages.cannotFindFunction('doesNotExist').code]: 'warn' as const
                }
            };

            stageBundle();
            let result = await runPlugin({ bsConfig: bsConfig });
            expect(result.errors).to.eql([]);
            expect(result.warnings.map(x => x.location?.file)).to.eql([s`${pkgDir}/source/main.bs`]);
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.brs`)).to.be.true;

            fsExtra.removeSync(bundleDir);
            stageBundle();
            result = await runPlugin({ bsConfig: bsConfig, warningsAsErrors: true });
            expect(result.warnings).to.eql([]);
            expect(result.errors.map(x => x.location?.file)).to.eql([s`${pkgDir}/source/main.bs`]);
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.brs`)).to.be.false;
        });

        it('does nothing when the TypeScript build already failed', async () => {
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('source/main.bs', `sub main()\nend sub`);
            stageBundle();
            const tsError = { text: 'TS error' };

            const result = await runPlugin(undefined, { errors: [tsError], warnings: [] });

            expect(result.errors).to.eql([tsError]);
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.bs`)).to.be.true;
        });

        it('uses the bsconfig.json found at the project root', async () => {
            fsExtra.outputJsonSync(s`${projectRoot}/bsconfig.json`, {
                rootDir: 'pkg',
                diagnosticFilters: [DiagnosticMessages.cannotFindFunction('doesNotExist').code]
            });
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('source/main.bs', `sub main()\n    doesNotExist()\nend sub`);
            stageBundle();

            const result = await runPlugin();

            expect(result.errors).to.eql([]);
            expect(fsExtra.pathExistsSync(s`${bundleDir}/source/main.brs`)).to.be.true;
        });
    });

    describe('withBrighterScript', () => {
        it('adds the plugin before hermes for TypeScript apps, for both build and dev', () => {
            const config = withBrighterScript({ app: { entryPoint: 'src/index.ts' } } as RokuSdkConfig);
            for (const section of [config.pipeline.build, config.pipeline.startDev]) {
                expect(section.plugins.map(x => [x.plugin.name, x.position])).to.eql([
                    ['brighterscript', { before: 'hermes' }]
                ]);
            }
        });

        it('adds the plugin first for brsOnly apps', () => {
            const config = withBrighterScript({ app: { brsOnly: true } });
            expect(config.pipeline.build.plugins[0].position).to.eql('first');
            expect(config.pipeline.startDev.plugins[0].position).to.eql('first');
        });

        it('keeps existing pipeline hooks and plugins', async () => {
            const calls = [];
            const transformManifest = (entries) => entries;
            const existingPlugin = { plugin: { name: 'mine', setup: () => { } }, position: 'last' };
            const config = withBrighterScript({
                app: {},
                appName: 'keep-me',
                pipeline: {
                    build: {
                        transformManifest: transformManifest,
                        preBuild: (ctx) => {
                            calls.push(ctx.isRebuild);
                        },
                        plugins: [existingPlugin]
                    }
                }
            } as RokuSdkConfig);
            expect(config.appName).to.eql('keep-me');
            expect(config.pipeline.build.transformManifest).to.equal(transformManifest);
            expect(config.pipeline.build.plugins[0]).to.equal(existingPlugin);
            expect(config.pipeline.build.plugins[1].plugin.name).to.eql('brighterscript');

            await config.pipeline.build.preBuild({ config: {}, isRebuild: true });
            expect(calls).to.eql([true]);
        });

        it('builds in the outDir rk reports to preBuild', async () => {
            writePkgFile('manifest', 'title=RkApp');
            writePkgFile('source/main.bs', `sub main()\nend sub`);
            const customBundleDir = s`${projectRoot}/custom-out/bundle`;
            fsExtra.copySync(pkgDir, customBundleDir);

            const config = withBrighterScript({ app: {}, rootDir: projectRoot });
            //rk merges command-line flags such as `--out-dir` into the config it hands to preBuild
            await config.pipeline.startDev.preBuild({ config: { app: {}, rootDir: projectRoot, outDir: 'custom-out' }, isRebuild: false });
            let onEnd: (result: RokuSdkBuildResult) => Promise<void>;
            config.pipeline.startDev.plugins[0].plugin.setup({
                onEnd: (callback) => {
                    onEnd = callback;
                }
            });
            const result = { errors: [], warnings: [] };
            await onEnd(result);

            expect(result.errors).to.eql([]);
            expect(fsExtra.pathExistsSync(s`${customBundleDir}/source/main.brs`)).to.be.true;
        });
    });

    describe('path helpers', () => {
        it('resolves the static folder like rk does', () => {
            expect(getRokuSdkStaticAssetsDir({ rootDir: projectRoot })).to.eql(s`${projectRoot}/pkg`);
            expect(getRokuSdkStaticAssetsDir({ rootDir: projectRoot, app: { brsOnly: true } })).to.eql(projectRoot);
            expect(getRokuSdkStaticAssetsDir({ rootDir: projectRoot, app: { staticAssetsDir: 'channel' } })).to.eql(s`${projectRoot}/channel`);
        });

        it('resolves the bundle folder like rk does', () => {
            expect(getRokuSdkBundleDir({ rootDir: projectRoot }, 'build')).to.eql(s`${projectRoot}/dist-build/bundle`);
            expect(getRokuSdkBundleDir({ rootDir: projectRoot }, 'startDev')).to.eql(s`${projectRoot}/dist-dev/bundle`);
            expect(getRokuSdkBundleDir({ rootDir: projectRoot, outDir: 'out' }, 'build')).to.eql(s`${projectRoot}/out/bundle`);
        });
    });
});
