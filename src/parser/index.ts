//tslint:disable
import * as fs from "fs";
import * as readline from "readline";
import { promisify } from "util";
import pSettle from "p-settle";
const readFile = promisify(fs.readFile);

import { Lexer } from "./lexer";
import * as PP from "./preprocessor";
import { Parser } from "./parser";
declare var Interpreter: any;
declare type Interpreter = any;
declare type ExecutionOptions = any;
declare var defaultExecutionOptions: any;
import * as BrsError from "./Error";

import * as _lexer from "./lexer";
export { _lexer as lexer };
import * as BrsTypes from "./brsTypes";
export { BrsTypes as types };
export { PP as preprocessor };
import * as _parser from "./parser";
export { _parser as parser };

/**
 * Executes a BrightScript file by path and writes its output to the streams
 * provided in `options`.
 *
 * @param filename the absolute path to the `.brs` file to be executed
 * @param options configuration for the execution, including the streams to use for `stdout` and
 *                `stderr` and the base directory for path resolution
 *
 * @returns a `Promise` that will be resolve if `filename` is successfully
 *          executed, or be rejected if an error occurs.
 */
export async function execute(filenames: string[], options: Partial<ExecutionOptions>) {
    const executionOptions = Object.assign(defaultExecutionOptions, options);

    let manifest = await PP.getManifest(executionOptions.root);

    // wait for all files to be read, lexed, and parsed, but don't exit on the first error
    let parsedFiles = await pSettle(
        filenames.map(async filename => {
            let contents;
            try {
                contents = await readFile(filename, "utf-8");
            } catch (err) {
                return Promise.reject({
                    message: `brs: can't open file '${filename}': [Errno ${err.errno}]`,
                });
            }

            let lexer = new Lexer();
            let preprocessor = new PP.Preprocessor();
            let parser = new Parser();
            [lexer, preprocessor, parser].forEach(emitter => emitter.onError(logError));

            let scanResults = lexer.scan(contents, filename);
            if (scanResults.errors.length > 0) {
                return Promise.reject({
                    message: "Error occurred during lexing",
                });
            }

            let preprocessResults = preprocessor.preprocess(scanResults.tokens, manifest);
            if (preprocessResults.errors.length > 0) {
                return Promise.reject({
                    message: "Error occurred during pre-processing",
                });
            }

            let parseResults = parser.parse(preprocessResults.processedTokens);
            if (parseResults.errors.length > 0) {
                return Promise.reject({
                    message: "Error occurred parsing",
                });
            }

            return Promise.resolve(parseResults.statements);
        })
    );

    // don't execute anything if there were reading, lexing, or parsing errors
    if (parsedFiles.some(file => file.isRejected)) {
        return Promise.reject({
            messages: parsedFiles
                .filter(file => file.isRejected)
                .map(rejection => rejection.reason.message),
        });
    }

    // combine statements from all files into one array
    let statements = parsedFiles
        .map(file => file.value || [])
        .reduce((allStatements, fileStatements) => [...allStatements, ...fileStatements], []);

    // execute them
    const interpreter = new Interpreter(executionOptions);
    interpreter.onError(logError);
    return interpreter.exec(statements);
}

/**
 * A synchronous version of `execute`. Executes a BrightScript file by path and writes its output to the streams
 * provided in `options`.
 *
 * @param filename the paths to BrightScript files to execute synchronously
 * @param options configuration for the execution, including the streams to use for `stdout` and
 *                `stderr` and the base directory for path resolution
 * @param args the set of arguments to pass to the `main` function declared in one of the provided filenames
 *
 * @returns the value returned by the executed file(s)
 */
export function executeSync(
    filenames: string[],
    options: Partial<ExecutionOptions>,
    args: BrsTypes.BrsType[]
) {
    const executionOptions = Object.assign(defaultExecutionOptions, options);
    const interpreter = new Interpreter(executionOptions); // shared between files

    let manifest = PP.getManifestSync(executionOptions.root);

    let allStatements = filenames
        .map(filename => {
            let contents = fs.readFileSync(filename, "utf8");
            let scanResults = Lexer.scan(contents, filename);
            let preprocessor = new PP.Preprocessor();
            let preprocessorResults = preprocessor.preprocess(scanResults.tokens, manifest);
            return Parser.parse(preprocessorResults.processedTokens).statements;
        })
        .reduce((allStatements, statements) => [...allStatements, ...statements], []);

    return interpreter.exec(allStatements, ...args);
}

/**
 * Launches an interactive read-execute-print loop, which reads input from
 * `stdin` and executes it.
 *
 * **NOTE:** Currently limited to single-line inputs :(
 */
export function repl() {
    const replInterpreter = new Interpreter();
    replInterpreter.onError(logError);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.setPrompt("brs> ");

    rl.on("line", line => {
        let results = run(line, defaultExecutionOptions, replInterpreter);
        if (results) {
            results.map(result => console.log(result.toString()));
        }

        rl.prompt();
    });

    rl.prompt();
}

/**
 * Runs an arbitrary string of BrightScript code.
 * @param contents the BrightScript code to lex, parse, and interpret.
 * @param options the streams to use for `stdout` and `stderr`. Mostly used for
 *                testing.
 * @param interpreter an interpreter to use when executing `contents`. Required
 *                    for `repl` to have persistent state between user inputs.
 * @returns an array of statement execution results, indicating why each
 *          statement exited and what its return value was, or `undefined` if
 *          `interpreter` threw an Error.
 */
function run(
    contents: string,
    options: ExecutionOptions = defaultExecutionOptions,
    interpreter: Interpreter
) {
    const lexer = new Lexer();
    const parser = new Parser();

    lexer.onError(logError);
    parser.onError(logError);

    const scanResults = lexer.scan(contents, "REPL");
    if (scanResults.errors.length > 0) {
        return;
    }

    const parseResults = parser.parse(scanResults.tokens);
    if (parseResults.errors.length > 0) {
        return;
    }

    if (parseResults.statements.length === 0) {
        return;
    }

    try {
        return interpreter.exec(parseResults.statements);
    } catch (e) {
        //options.stderr.write(e.message);
        return;
    }
}

/**
 * Logs a detected BRS error to stderr.
 * @param err the error to log to `stderr`
 */
function logError(err: BrsError.BrsError) {
    console.error(err.format());
}
