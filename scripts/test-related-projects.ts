import * as path from 'path';
import * as child_process from 'child_process';
import * as fsExtra from 'fs-extra';
import { version } from '../package.json';
import M = require('minimatch');
import * as os from 'os';
import chalk from 'chalk';
const tempDir = path.join(os.tmpdir(), 'brighterscript-tmp');
const cwd = path.dirname(__dirname);

const projects: Project[] = [
    {
        name: 'bslint',
        url: 'https://github.com/rokucommunity/bslint',
        branch: 'master',
        testCommand: 'npm run test'
    },
    {
        name: 'rooibos',
        url: 'https://github.com/georgejecook/rooibos',
        cwd: './bsc-plugin',
        testCommand: 'npm run test'
    },
    {
        name: 'roku-log-bsc-plugin',
        url: 'https://github.com/georgejecook/roku-log-bsc-plugin',
        testCommand: 'npm run test'
    },
    {
        name: 'maestro-roku-bsc-plugin',
        url: 'https://github.com/georgejecook/maestro-roku-bsc-plugin',
        testCommand: 'npm run test',
        success: true
    }
];


let bscTarballPath: string;

function main() {
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
    for (const project of projects) {
        try {
            testProject(project);
            project.success = true;
        } catch {
            project.success = false;
        }
    }

    //print the final results
    let maxLength = Math.max(...projects.map(x => x.name.length));
    //force an even number
    maxLength += (maxLength % 2 === 0) ? 1 : 0;
    //add some padding
    maxLength += 6;
    let headerPadding = (maxLength - 'Results'.length) + 6;
    console.log('\n\n' + chalk.yellow(
        '-'.repeat(headerPadding / 2) + 'Results' + '-'.repeat(headerPadding / 2)
    ));
    for (const project of projects) {
        const color = project.success ? chalk.green : chalk.red;
        console.log(
            project.name.padEnd(maxLength, '-').replace(/-/g, chalk.grey('-')) + color(project.success ? 'passed' : 'failed')
        );
    }

    //clean the temp dir
    // fsExtra.emptyDirSync(tempDir);
}

function testProject(project: typeof projects[0]) {
    const projectDir = path.join(tempDir, project.name);
    const options = {
        cwd: path.join(projectDir, project.cwd ?? '.')
    };
    fsExtra.removeSync(projectDir);

    logStep(project.name, `Cloning ${project.name} (${project.url})`);
    execSync(`git clone ${project.url} ${projectDir}`);

    if (project.branch) {
        logStep(project.name, `Checkint out branch "${project.branch}"`);
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

interface Project {
    name: string;
    url: string;
    cwd?: string;
    testCommand: string;
    branch?: string;
    success?: boolean;
}

main();
