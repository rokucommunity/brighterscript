#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { ProgramBuilder } from './ProgramBuilder';
import { DiagnosticSeverity } from 'vscode-languageserver';
import util from './util';
import { LanguageServer } from './LanguageServer';
import chalk from 'chalk';

import * as fsExtra from 'fs-extra';
import * as readline from 'readline';
import { execSync } from 'child_process';
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let options = yargs
    .usage('$0', 'BrighterScript, a superset of Roku\'s BrightScript language')
    .help('help', 'View help information about this tool.')
    .option('create-package', { type: 'boolean', defaultDescription: 'true', description: 'Creates a zip package. This setting is ignored when deploy is enabled.' })
    .option('source-map', { type: 'boolean', defaultDescription: 'false', description: 'Enables generating sourcemap files, which allow debugging tools to show the original source code while running the emitted files.' })
    .option('allow-brighterscript-in-brightscript', { alias: 'allow-brighter-script-in-bright-script', type: 'boolean', defaultDescription: 'false', description: 'Allow brighterscript features (classes, interfaces, etc...) to be included in BrightScript (`.brs`) files, and force those files to be transpiled..' })
    .option('cwd', { type: 'string', description: 'Override the current working directory.' })
    .option('copy-to-staging', { type: 'boolean', defaultDescription: 'true', description: 'Copy project files into the staging folder, ready to be packaged.' })
    .option('diagnostic-level', { type: 'string', defaultDescription: '"warn"', description: 'Specify what diagnostic types should be printed to the console. Value can be "error", "warn", "hint", "info".' })
    .option('plugins', { type: 'array', alias: 'plugin', description: 'A list of scripts or modules to add extra diagnostics or transform the AST.' })
    .option('deploy', { type: 'boolean', defaultDescription: 'false', description: 'Deploy to a Roku device if compilation succeeds. When in watch mode, this will deploy on every change.' })
    .option('emit-full-paths', { type: 'boolean', defaultDescription: 'false', description: 'Emit full paths to files when encountering diagnostics.' })
    .option('files', { type: 'array', description: 'The list of files (or globs) to include in your project. Be sure to wrap these in double quotes when using globs.' })
    .option('host', { type: 'string', description: 'The host used when deploying to a Roku.' })
    .option('ignore-error-codes', { type: 'array', description: 'A list of error codes that the compiler should NOT emit, even if encountered.' })
    .option('no-project', { type: 'boolean', defaultDescription: 'false', description: 'When set, bsconfig.json loading is disabled', alias: ['noproject', 'noProject'] })
    .option('log-level', { type: 'string', defaultDescription: '"log"', description: 'The log level. Value can be "error", "warn", "log", "info", "debug".' })
    .option('out-file', { type: 'string', description: 'Path to the zip folder containing the bundled project. Defaults to `./out/[YOUR_ROOT_FOLDER_NAME].zip' })
    .option('password', { type: 'string', description: 'The password for deploying to a Roku.' })
    .option('project', { type: 'string', description: 'Path to a bsconfig.json project file.' })
    .option('retain-staging-folder', { type: 'boolean', defaultDescription: 'false', description: 'Prevent the staging folder from being deleted after creating the package.' })
    .option('root-dir', { type: 'string', description: 'Path to the root of your project files (where the manifest lives). Defaults to current directory.' })
    .option('staging-folder-path', { type: 'string', description: 'The path where the files should be staged (right before being zipped up).' })
    .option('username', { type: 'string', defaultDescription: '"rokudev"', description: 'The username for deploying to a Roku.' })
    .option('source-root', { type: 'string', description: 'Override the root directory path where debugger should locate the source files. The location will be embedded in the source map to help debuggers locate the original source files. This only applies to files found within rootDir. This is useful when you want to preprocess files before passing them to BrighterScript, and want a debugger to open the original files.' })
    .option('watch', { type: 'boolean', defaultDescription: 'false', description: 'Watch input files.' })
    .option('require', { type: 'array', description: 'A list of modules to require() on startup. Useful for doing things like ts-node registration.' })
    .option('profile', { type: 'boolean', defaultDescription: 'false', description: 'Generate a cpuprofile report during this run' })
    .option('lsp', { type: 'boolean', defaultDescription: 'false', description: 'Run brighterscript as a language server.' })
    .check(argv => {
        const diagnosticLevel = argv.diagnosticLevel as string;
        //if we have the diagnostic level and it's not a known value, then fail
        if (diagnosticLevel && ['error', 'warn', 'hint', 'info'].includes(diagnosticLevel) === false) {
            throw new Error(`Invalid diagnostic level "${diagnosticLevel}". Value can be "error", "warn", "hint", "info".`);
        }
        const cwd = path.resolve(process.cwd(), argv.cwd ?? process.cwd());
        //cli-provided plugin paths should be relative to cwd
        util.resolvePathsRelativeTo(argv, 'plugins', cwd);
        //cli-provided require paths should be relative to cwd
        util.resolvePathsRelativeTo(argv, 'require', cwd);
        return true;
    })
    .argv;

async function main() {
    try {
        initProfiling();

        if (options.lsp) {
            const server = new LanguageServer();
            server.run();
        } else {
            let builder = new ProgramBuilder();
            await builder.run(<any>options);
            //if this is a single run (i.e. not watch mode) and there are error diagnostics, return an error code
            const hasError = !!builder.getDiagnostics().find(x => x.severity === DiagnosticSeverity.Error);
            if (builder.options.watch) {
                //watch mode is enabled. wait for user input asking to cancel
                await askQuestion('Press <enter> to terminate the watcher\n');
                await finalize(1, builder);
            } else {
                if (hasError) {
                    await finalize(1, builder);
                } else {
                    await finalize(0, builder);
                }
            }
        }
    } catch (e) {
        console.error(e);
        await finalize(1);
    }
}

function askQuestion(question) {
    return new Promise((resolve, reject) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

const profileTitle = `bsc-profile-${Date.now()}`;

let isFinalized = false;
async function finalize(exitCode: number, builder?: ProgramBuilder) {
    if (isFinalized) {
        return;
    }
    isFinalized = true;
    await finalizeProfiling();
    try {
        builder?.dispose?.();
    } catch (e) {
        console.error(e);
    }
    rl.close();
    process.exit(exitCode);
}

let v8Profiler;

function initProfiling() {
    if (options.profile) {
        console.log('Installing v8-profiler-next');
        execSync('npm install v8-profiler-next@^1.9.0', {
            stdio: 'inherit',
            cwd: `${__dirname}/../`
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        v8Profiler = require('v8-profiler-next');
        // set generateType 1 to generate new format for cpuprofile parsing in vscode.
        v8Profiler.setGenerateType(1);
        v8Profiler.startProfiling(profileTitle, true);
    }
}
function finalizeProfiling() {
    return new Promise<void>((resolve, reject) => {
        try {
            if (options.profile) {
                const profileResultPath = path.join(process.cwd(), `${Date.now()}-${profileTitle}.cpuprofile`);
                console.log(`Writing profile result to:`, chalk.green(profileResultPath));
                const profile = v8Profiler.stopProfiling(profileTitle);
                profile.export((error, result) => {
                    fsExtra.writeFileSync(profileResultPath, result);
                    profile.delete();
                    resolve();
                });
            } else {
                resolve();
            }
        } catch (e) {
            reject(e);
        }
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
