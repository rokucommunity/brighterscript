import { execSync } from 'child_process';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../src';
import * as clipboard from 'clipboardy';

/**
 * Create a temporary package with a unique name to prevent local caching
 */
const date = Date.now();
const packageJsonContents = fsExtra.readFileSync(`${__dirname}/../package.json`).toString();
const version = require('../package.json').version;
try {
    //temporarily change the package version
    fsExtra.outputFileSync(
        `${__dirname}/../package.json`,
        packageJsonContents.replace(/"version": ".*"/, `"version": "${version}-test.${date}"`)
    );

    const newPath = s`${__dirname}/../.tmp/brighterscript-${version}-test.${date}.tgz`.replace(/\\/g, '/');

    execSync('npm run build && npm pack', { stdio: 'inherit', cwd: `${__dirname}/../` });
    fsExtra.moveSync(`brighterscript-${version}-test.${date}.tgz`, newPath);
    console.log(newPath);
    clipboard.writeSync('npm i file:' + newPath);
    console.log('copied to clipboard');
} finally {
    //restore the version rename the version
    fsExtra.outputFileSync(
        `${__dirname}/../package.json`,
        packageJsonContents
    );
}
