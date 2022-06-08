import * as path from 'path';
import * as child_process from 'child_process';
import * as fsExtra from 'fs-extra';
import { version } from '../package.json';
import M = require('minimatch');
const projects = [
    // enable once rooibos tests work on Windows devices
    // {
    //     name: 'rooibos',
    //     url: 'https://github.com/georgejecook/rooibos',
    //     cwd: './bsc-plugin',
    //     testCommand: 'npm i && npm run preversion'
    // },
    {
        name: 'roku-log-bsc-plugin',
        url: 'https://github.com/georgejecook/roku-log-bsc-plugin',
        testCommand: 'npm run test'
    },
    {
        name: 'bslint',
        url: 'https://github.com/rokucommunity/bslint',
        branch: 'master',
        testCommand: 'npm run test'
    }
];

const cwd = path.dirname(__dirname);
const tempDir = path.join(cwd, '.tmp');
let bscTarballPath: string;

async function main() {
    console.log('Cleaning temp directory');
    fsExtra.emptyDirSync(tempDir);

    console.log('building brighterscript');
    execSync('npm install && npm run build', { cwd: cwd });
    console.log('packaging brighterscript');
    execSync('npm pack', { cwd: cwd });
    let initialBscTarballPath = path.join(cwd, `brighterscript-${version}.tgz`);
    bscTarballPath = path.join(tempDir,
        path.basename(
            initialBscTarballPath.replace(/\.tgz$/, Date.now() + '.tgz')
        )
    );
    //move the tarball to a distinct file path to prevent local caching from breaking the tests
    fsExtra.moveSync(initialBscTarballPath, bscTarballPath);
    try {
        for (const project of projects) {
            await testProject(project);
        }
    } finally {
        // console.log('Cleaning temp directory');
        // fsExtra.emptyDirSync(tempDir);
    }
}

async function testProject(project: typeof projects[0]) {
    const projectDir = path.join(tempDir, project.name);
    const options = {
        cwd: path.join(projectDir, project.cwd ?? '.')
    };

    logStep(project.name, `Cloning ${project.name} (${project.url})`);
    execSync(`git clone ${project.url} ${projectDir}`);

    if (project.branch) {
        logStep(project.name, `Cloning ${project.name} (${project.url})`);
        execSync(`git checkout ${project.branch}`, { cwd: projectDir });
    }

    logStep(project.name, 'installing node modules');
    execSync('npm install', options);

    logStep(project.name, 'Running test command');
    execSync(project.testCommand, options);

    logStep(project.name, 'Installing local version of brighterscript');
    execSync(`npm install "file:/${bscTarballPath}"`, options);

    logStep(project.name, 'Running test command again, this time against local brighterscript');
    execSync(project.testCommand, options);
    await Promise.resolve();
}

function logStep(projectName: string, ...messages: string[]) {
    console.log('\n\n' + '-'.repeat(100) + '\n', `${projectName}: `, ...messages, '\n' + '-'.repeat(100) + '\n');
}

function execSync(command: string, options?: child_process.ExecOptions) {
    child_process.execSync(command, {
        stdio: 'inherit',
        ...options ?? {}
    });

}
main().catch(e => console.error(e));
