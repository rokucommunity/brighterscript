import { expect } from '../chai-config.spec';
import * as fsExtra from 'fs-extra';
import { discoverRsgProject, parseRokuConfig } from './RsgProject';
import { tempDir } from '../testHelpers.spec';
import { standardizePath as s } from '../util';
import { ProgramBuilder } from '../ProgramBuilder';

describe('RsgProject', () => {
    const projectDir = s`${tempDir}/rsgApp`;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        fsExtra.removeSync(tempDir);
    });

    function writeFiles(files: Record<string, string>) {
        for (const [filePath, contents] of Object.entries(files)) {
            fsExtra.outputFileSync(s`${projectDir}/${filePath}`, contents);
        }
    }

    const rokuConfig = `
        import { getBuildType, RokuConfig } from "@roku-sdk/rsg-ts/roku-config";

        const configuration: RokuConfig = {
            app: {
                entryPoint: "src/index.ts",
                manifestEntries: {
                    title: \`Sample (\${getBuildType()})\`,
                    rsg_version: "2.0"
                }
            }
        };

        export default configuration;
    `;

    describe('parseRokuConfig', () => {
        it('reads the entry point', () => {
            expect(parseRokuConfig(rokuConfig)).to.eql({
                entryPoint: 'src/index.ts',
                brsOnly: false
            });
        });

        it('reads an inline default export', () => {
            expect(parseRokuConfig(`
                export default {
                    app: { entryPoint: 'app/main.tsx', staticAssetsDir: './static' }
                } satisfies RokuConfig;
            `)).to.eql({
                entryPoint: 'app/main.tsx',
                brsOnly: false
            });
        });

        it('reads BrightScript-only apps', () => {
            expect(parseRokuConfig(`
                export default { app: { brsOnly: true, staticAssetsDir: "./pkg" } };
            `)).to.eql({
                entryPoint: undefined,
                brsOnly: true
            });
        });

        it('ignores an entry point that is not a string literal', () => {
            expect(parseRokuConfig(`
                export default { app: { entryPoint: getEntry() } };
            `).entryPoint).to.be.undefined;
        });
    });

    describe('discoverRsgProject', () => {
        it('finds anchor nodes in every file reachable from the entry point', () => {
            writeFiles({
                'roku-config.ts': rokuConfig,
                'src/index.ts': `
                    import { main, registerAnchorNode } from "@roku-sdk/rsg-ts";
                    import "./compiled-components/ButtonBase.xml";
                    import ViewOne from "./components/view-one";
                    import ViewTwo from "./components/view-two.js";
                    export * from "./components/shared";
                    main(() => {
                        registerAnchorNode(ViewOne);
                        registerAnchorNode(ViewTwo);
                    });
                `,
                'src/components/view-one.tsx': `
                    import { defineAnchorNode, FieldType } from "@roku-sdk/rsg-ts";
                    const ViewOneDescriptor = {
                        componentName: "ViewOne",
                        extends: "Group" as const,
                        inputFields: { changeVisibility: FieldType.Boolean(true) },
                        outputFields: { sendData: FieldType.Object() }
                    };
                    export default defineAnchorNode(ViewOneDescriptor, (inputs, outputs) => <group />);
                `,
                'src/components/view-two.tsx': `
                    import { defineAnchorNode, FieldType } from "@roku-sdk/rsg-ts";
                    import { ViewTwoDescriptor } from "./descriptors";
                    export default defineAnchorNode(ViewTwoDescriptor, () => <group />);
                `,
                'src/components/descriptors/index.ts': `
                    import { FieldType } from "@roku-sdk/rsg-ts";
                    export const ViewTwoDescriptor = { componentName: "ViewTwo", extends: "ButtonBase", inputFields: {}, outputFields: {} };
                `,
                'src/components/shared.ts': `export const shared = 1;`,
                //not imported by anything, so it is not part of the app
                'src/components/unused.tsx': `
                    import { defineAnchorNode } from "@roku-sdk/rsg-ts";
                    export default defineAnchorNode({ componentName: "Unused", extends: "Group" }, () => <group />);
                `
            });

            const project = discoverRsgProject(s`${projectDir}/roku-config.ts`);
            expect(project.problems).to.eql([]);
            expect(project.entryPoint).to.eql(s`${projectDir}/src/index.ts`);
            expect(project.sourceFiles.sort()).to.eql([
                s`${projectDir}/src/components/descriptors/index.ts`,
                s`${projectDir}/src/components/shared.ts`,
                s`${projectDir}/src/components/view-one.tsx`,
                s`${projectDir}/src/components/view-two.tsx`,
                s`${projectDir}/src/index.ts`
            ]);
            expect(project.xmlComponentImports).to.eql([
                s`${projectDir}/src/compiled-components/ButtonBase.xml`
            ]);
            expect(
                project.anchorNodes.map(x => ({ name: x.componentName, extends: x.extends, srcPath: x.srcPath })).sort((a, b) => a.name.localeCompare(b.name))
            ).to.eql([
                { name: 'ViewOne', extends: 'Group', srcPath: s`${projectDir}/src/components/view-one.tsx` },
                { name: 'ViewTwo', extends: 'ButtonBase', srcPath: s`${projectDir}/src/components/descriptors/index.ts` }
            ]);
        });

        it('handles circular imports', () => {
            writeFiles({
                'roku-config.ts': rokuConfig,
                'src/index.ts': `import "./a"; import { defineAnchorNode } from "@roku-sdk/rsg-ts"; const d = { componentName: "Root", extends: "Group" };`,
                'src/a.ts': `import "./index";`
            });
            const project = discoverRsgProject(s`${projectDir}/roku-config.ts`);
            expect(project.sourceFiles).to.have.lengthOf(2);
            expect(project.anchorNodes.map(x => x.componentName)).to.eql(['Root']);
        });

        it('reports a missing roku-config file or entry point', () => {
            expect(discoverRsgProject(s`${projectDir}/roku-config.ts`).problems).to.have.lengthOf(1);

            writeFiles({ 'roku-config.ts': rokuConfig });
            const project = discoverRsgProject(s`${projectDir}/roku-config.ts`);
            expect(project.problems).to.eql([
                `Entry point 'src/index.ts' from '${s`${projectDir}/roku-config.ts`}' does not exist`
            ]);
            expect(project.anchorNodes).to.eql([]);
        });

        it('does not look for TypeScript in BrightScript-only apps', () => {
            writeFiles({
                'roku-config.ts': `export default { app: { brsOnly: true } };`
            });
            const project = discoverRsgProject(s`${projectDir}/roku-config.ts`);
            expect(project.problems).to.eql([]);
            expect(project.sourceFiles).to.eql([]);
        });
    });

    describe('ProgramBuilder', () => {
        it('discovers the project from the `rokuConfig` option', async () => {
            writeFiles({
                'roku-config.ts': rokuConfig,
                'src/index.ts': `
                    import { defineAnchorNode, FieldType } from "@roku-sdk/rsg-ts";
                    const d = { componentName: "HomeScreen", extends: "Group", inputFields: { title: FieldType.String() } };
                `,
                'pkg/manifest': 'title=Sample',
                'pkg/source/main.brs': 'sub main()\nend sub'
            });
            const builder = new ProgramBuilder();
            try {
                await builder.run({
                    cwd: projectDir,
                    rootDir: s`${projectDir}/pkg`,
                    rokuConfig: 'roku-config.ts',
                    validate: false,
                    noEmit: true,
                    createPackage: false,
                    logLevel: 'error'
                });
                expect(builder.program.rsgProject?.anchorNodes.map(x => x.componentName)).to.eql(['HomeScreen']);
            } finally {
                builder.dispose();
            }
        });

        it('resolves `rokuConfig` relative to the bsconfig file', async () => {
            writeFiles({
                'roku-config.ts': rokuConfig,
                'src/index.ts': `import { FieldType } from "@roku-sdk/rsg-ts"; const d = { componentName: "FromBsconfig", extends: "Group" };`,
                'pkg/manifest': 'title=Sample',
                'bsconfig.json': JSON.stringify({ rootDir: 'pkg', rokuConfig: './roku-config.ts' })
            });
            const builder = new ProgramBuilder();
            try {
                await builder.run({
                    project: s`${projectDir}/bsconfig.json`,
                    validate: false,
                    noEmit: true,
                    createPackage: false,
                    logLevel: 'error'
                });
                expect(builder.program.rsgProject?.rokuConfigPath).to.eql(s`${projectDir}/roku-config.ts`);
                expect(builder.program.rsgProject?.anchorNodes.map(x => x.componentName)).to.eql(['FromBsconfig']);
            } finally {
                builder.dispose();
            }
        });

        it('does nothing when `rokuConfig` is not set', async () => {
            writeFiles({ 'pkg/manifest': 'title=Sample' });
            const builder = new ProgramBuilder();
            try {
                await builder.run({ rootDir: s`${projectDir}/pkg`, validate: false, noEmit: true, createPackage: false, logLevel: 'error' });
                expect(builder.program.rsgProject).to.be.undefined;
            } finally {
                builder.dispose();
            }
        });
    });
});
