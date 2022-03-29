import { standardizePath as s } from './util';
import * as fsExtra from 'fs-extra';
import { execSync } from 'child_process';
import { expect } from 'chai';

const tempDir = s`${process.cwd()}/.tmp`;
const cliPath = s`${__dirname}/cli.ts`;

describe('cli', () => {
    let idx = 0;
    let cwd: string;
    beforeEach(() => {
        cwd = s`${tempDir}/cli-test-${idx}`;
        fsExtra.ensureDirSync(cwd);
    });
    afterEach(() => {
        fsExtra.emptyDirSync(cwd);
    });

    if (process.argv.includes('--all')) {
        it('loads ts-node from the --require flag', () => {
            fsExtra.outputFileSync(s`${cwd}/manifest`, '');
            const modulePath = s`${cwd}/module.js`;
            //simple plugin that writes a file. If the file exists, we know the require syntax works
            fsExtra.outputFileSync(modulePath, `
            var fs = require('fs');
            fs.writeFileSync('./testResult.txt', '');
        `);
            execSync(`npx ts-node-transpile-only "${cliPath}" --require "${modulePath}"`, {
                cwd: cwd
            });
            expect(
                fsExtra.pathExistsSync(s`${cwd}/testResult.txt`)
            ).to.be.true;
        });
    }
});
