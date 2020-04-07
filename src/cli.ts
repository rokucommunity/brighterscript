#!/usr/bin/env node
import * as commandLineArgs from 'command-line-args';
import * as commandLineUsage from 'command-line-usage';

import { ProgramBuilder } from './ProgramBuilder';

let args = [
    { name: 'project', type: String, description: 'Path to a bsconfig.json project file.' },
    { name: 'cwd', type: String, description: 'Override the current working directory.' },
    { name: 'root-dir', type: String, description: 'Path to the root of your project files (where the manifest lives). Defaults to current directory.' },
    { name: 'files', type: String, multiple: true, defaultOption: true, description: 'The list of files (or globs) to include in your project. Be sure to wrap these in double quotes when using globs.' },
    { name: 'out-file', type: String, description: 'Path to the zip folder containing the bundled project. Defaults to `./out/[YOUR_ROOT_FOLDER_NAME].zip' },
    { name: 'create-package', type: Boolean, description: 'Creates a zip package. Defaults to true. This setting is ignored when deploy is enabled.' },
    { name: 'watch', type: Boolean, description: 'Watch input files.' },
    { name: 'deploy', type: Boolean, description: 'Deploy to a Roku device if compilation succeeds. When in watch mode, this will deploy on every change. Defaults to false' },
    { name: 'host', type: String, description: 'The host used when deploying to a Roku.' },
    { name: 'username', type: String, description: 'The username for deploying to a Roku. Defaults to "rokudev".' },
    { name: 'password', type: String, description: 'The password for deploying to a Roku.' },
    { name: 'ignore-error-codes', type: Number, multiple: true, description: ' A list of error codes that the compiler should NOT emit, even if encountered.' },
    { name: 'emit-full-paths', type: Boolean, description: 'Emit full paths to files when encountering diagnostics. Defaults to false' },
    { name: 'retain-staging-folder', type: Boolean, description: 'Prevent the staging folder from being deleted after creating the package. Defaults to false' },
    { name: 'staging-folder-path', type: String, description: 'The path where the files should be staged (right before being zipped up).' },
    { name: 'help', type: Boolean, description: 'View help information about this tool.' }
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
        const hasError = !!builder.getDiagnostics().find(x => x.severity === 'error');
        if (builder.options.watch === false && hasError) {
            process.exit(-1);
        }
    }).catch((error) => {
        console.error(error);
        process.exit(-1);
    });
}
