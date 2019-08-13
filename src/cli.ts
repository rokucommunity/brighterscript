#!/usr/bin/env node
import * as commandLineArgs from 'command-line-args';
import * as commandLineUsage from 'command-line-usage';

import { ProgramBuilder } from './ProgramBuilder';

let args = [
    { name: 'project', type: String, description: 'Path to a brsconfig.json project file.' },
    { name: 'cwd', type: String, description: 'Override the current working directory.' },
    { name: 'root-dir', type: String, description: 'Path to the root of your project files (where the manifest lives). Defaults to current directory.' },
    { name: 'files', type: String, multiple: true, defaultOption: true, description: 'The list of files (or globs) to include in your project. Be sure to wrap these in double quotes when using globs.' },
    { name: 'out-file', type: String, description: 'Path to the zip folder containing the bundled project. Defaults to `./out/[YOUR_ROOT_FOLDER_NAME].zip' },
    { name: 'skip-package', type: String, description: 'Prevents the zip file from being created. This has no effect if deploy is true.' },
    { name: 'watch', type: Boolean, description: 'Watch input files.' },
    { name: 'deploy', type: Boolean, description: 'Deploy to a Roku device if compilation succeeds. When in watch mode, this will deploy on every change. Defaults to false' },
    { name: 'host', type: String, description: 'The host used when deploying to a Roku.' },
    { name: 'username', type: String, description: 'The username for deploying to a Roku. Defaults to "rokudev".' },
    { name: 'password', type: String, description: 'The password for deploying to a Roku.' },
    { name: 'ignore-error-codes', type: Number, multiple: true, description: ' A list of error codes that the compiler should NOT emit, even if encountered.' },
    { name: 'emit-full-paths', type: Boolean, description: 'Emit full paths to files when encountering diagnostics. Defaults to false' },
    { name: 'help', type: Boolean, description: 'View help information about this tool.' }
];
const options = commandLineArgs(args, { camelCase: true });
if (options.help) {
    //wire up the help docs
    const usage = commandLineUsage([{
        header: 'BrightScript',
        content: 'A full suite of tools for the BrightScript language'
    }, {
        header: 'Options',
        optionList: args
    }]);
    console.log(usage);
} else {
    let builder = new ProgramBuilder();
    builder.run(<any>options)
        .then(() => { })
        .catch((error) => {
            console.error(error);
            process.exit(-1);
        });
}
