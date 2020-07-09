#!/usr/bin/env node
import * as commandLineArgs from 'command-line-args';
import * as commandLineUsage from 'command-line-usage';
import { ProgramBuilder } from './ProgramBuilder';
import { DiagnosticSeverity } from 'vscode-languageserver';

let args = [
    { name: 'create-package', type: Boolean, description: 'Creates a zip package. Defaults to true. This setting is ignored when deploy is enabled.' },
    { name: 'cwd', type: String, description: 'Override the current working directory.' },
    { name: 'deploy', type: Boolean, description: 'Deploy to a Roku device if compilation succeeds. When in watch mode, this will deploy on every change. Defaults to false' },
    { name: 'emit-full-paths', type: Boolean, description: 'Emit full paths to files when encountering diagnostics. Defaults to false' },
    { name: 'files', type: String, multiple: true, defaultOption: true, description: 'The list of files (or globs) to include in your project. Be sure to wrap these in double quotes when using globs.' },
    { name: 'help', type: Boolean, description: 'View help information about this tool.' },
    { name: 'host', type: String, description: 'The host used when deploying to a Roku.' },
    { name: 'ignore-error-codes', type: Number, multiple: true, description: ' A list of error codes that the compiler should NOT emit, even if encountered.' },
    { name: 'log-level', type: String, description: 'The log level. Values can be "error", "warn", "log", "info", "debug". Defaults to "log"' },
    { name: 'out-file', type: String, description: 'Path to the zip folder containing the bundled project. Defaults to `./out/[YOUR_ROOT_FOLDER_NAME].zip' },
    { name: 'password', type: String, description: 'The password for deploying to a Roku.' },
    { name: 'project', type: String, description: 'Path to a bsconfig.json project file.' },
    { name: 'retain-staging-folder', type: Boolean, description: 'Prevent the staging folder from being deleted after creating the package. Defaults to false' },
    { name: 'root-dir', type: String, description: 'Path to the root of your project files (where the manifest lives). Defaults to current directory.' },
    { name: 'staging-folder-path', type: String, description: 'The path where the files should be staged (right before being zipped up).' },
    { name: 'username', type: String, description: 'The username for deploying to a Roku. Defaults to "rokudev".' },
    { name: 'source-root', type: String, description: 'Override the root directory path where debugger should locate the source files. The location will be embedded in the source map to help debuggers locate the original source files. This only applies to files found within rootDir. This is useful when you want to preprocess files before passing them to BrighterScript, and want a debugger to open the original files.' },
    { name: 'watch', type: Boolean, description: 'Watch input files.' }
];
const options = commandLineArgs(args, { camelCase: true });
if (options.help) {
    //wire up the help docs
    const usage = commandLineUsage([{
        header: 'BrighterScript',
        content: 'A superset of Roku\'s BrightScript language'
    }, {
        header: 'Options',
        optionList: args
    }]);
    console.log(usage);
} else {
    let builder = new ProgramBuilder();
    builder.run(<any>options).then(() => {
        //if this is a single run (i.e. not watch mode) and there are error diagnostics, return an error code
        const hasError = !!builder.getDiagnostics().find(x => x.severity === DiagnosticSeverity.Error);
        if (builder.options.watch === false && hasError) {
            process.exit(1);
        }
    }).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
