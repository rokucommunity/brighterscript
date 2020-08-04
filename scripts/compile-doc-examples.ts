import * as fsExtra from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';
import { Range } from 'vscode-languageserver';
import { Program } from '../src/Program';
import { BsConfig } from '../src';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';

const enableDebugLogging = false;

class DocCompiler {

    public constructor(
        readonly docPath: string,
        readonly enableDebugLogging: boolean
    ) {

    }
    private lines: string[];
    private index: number;
    private bsconfig: BsConfig;

    //move to the next line, and return that next line
    private advance() {
        this.index++;
        this.printLine(this.index);
        this.checkForBsConfigChanges();
        return this.currentLine;
    }

    /**
     * Look for special bsconfig "comments" in the markdown, and update the current bsconfig.json accordingly. 
     * These bsconfig comments change the compile options for the rest of the file, unless another comment is found
     */
    private checkForBsConfigChanges() {
        if (this.currentLine.includes(`[bsconfig.json]`)) {
            let text = this.currentLine.split('#')[1].trim();

            let parseErrors = [] as ParseError[];
            this.bsconfig = parseJsonc(text, parseErrors) as BsConfig;
            if (parseErrors.length > 0) {
                throw new Error(
                    'bsconfig.json parse error ' +
                    printParseErrorCode(parseErrors[0].error) +
                    ' at json offset ' + parseErrors[0].offset +
                    ` at location ${this.docPath}:${this.index + 1}`
                );
            }
        }
    }

    private get currentLine() {
        return this.lines[this.index];
    }

    private get nextLine() {
        return this.lines[this.index + 1];
    }

    public async run() {
        //get the docs file contents
        let contents = fsExtra.readFileSync(this.docPath).toString();
        //split the doc by newline
        this.lines = contents.split(/\r?\n/g);
        this.index = -1;

        while (this.nextLine !== undefined) {
            this.advance();
            if (this.currentLine.includes('```')) {
                await this.processCodeBlock();
            }
        }

        var result = this.lines.join('\n');
        fsExtra.writeFileSync(this.docPath, result);
        delete this.lines;
        this.index = -1;
    }

    private consumeCodeBlock() {
        if (this.currentLine.includes('```') === false) {
            return null;
        }
        const result = {
            language: '',
            startIndex: this.index,
            endIndex: -1,
            code: ''
        };

        //step past the opening ```
        let openingLine = this.currentLine;

        const lines = [] as string[];

        //get the language from this code block
        result.language = openingLine.trimLeft().replace('```', '').trim().toLowerCase();

        //find the rest of the source code block
        while (this.nextLine !== undefined && this.advance().includes('```') === false) {
            lines.push(this.currentLine);
        }

        result.endIndex = this.index

        //step past the closing ```
        this.advance();

        result.code = lines.join('\n');
        this.logDebug(`Found "${result.language}" code block at lines ${result.startIndex + 1}-${result.endIndex + 1}`);
        return result;
    }

    private logDebug(...messages) {
        if (this.enableDebugLogging) {
            console.debug(...messages);
        }
    }

    public async processCodeBlock() {
        //get the source code block
        const sourceCodeBlock = this.consumeCodeBlock();

        //if the code block is not brighterscript, then exit here...no transpile necessary
        if (sourceCodeBlock.language !== 'brighterscript') {
            return;
        }

        //walk forward until we find the next code block
        while (this.advance().includes('```') === false) { }

        //get the nex code block, which _should_ be the target transpile block
        const transpiledCodeBlock = this.consumeCodeBlock();
        if (!transpiledCodeBlock || transpiledCodeBlock.language !== 'brightscript') {
            throw new Error(`Could not find a transpiled code block for source code: ${this.docPath}:${sourceCodeBlock.startIndex}`);
        }

        //now that we have the range for the transpiled code, we need to transpile the source code
        console.log(`Transpiling ${sourceCodeBlock.language} block at lines ${sourceCodeBlock.startIndex}-${sourceCodeBlock.endIndex}`);
        var transpiledCode = await this.transpile(sourceCodeBlock.code);
        let transpiledLines = transpiledCode.split(/\r?\n/g);

        //replace the old transpiled lines with the new ones
        const lineDiff = this.replaceLines(transpiledCodeBlock.startIndex + 1, transpiledCodeBlock.endIndex - 1, transpiledLines);

        //set the index to the location past the trailing ```
        this.index += lineDiff;
    }

    /**
     * Replace lines. 
     * @param startLineIndex - the index of the first line to begin replacing at. this line gets replaced.
     * @param endLineIndex - the index of the final line to be replaced. this line gets replaced
     * @returns the difference in line count from old to new
     */
    private replaceLines(startLineIndex: number, endLineIndex: number, newLines: string[]) {
        const deletedItems = this.lines.splice(
            startLineIndex,
            (endLineIndex - startLineIndex) + 1,
            ...newLines
        );
        return deletedItems.length - newLines.length;
    }

    /**
     * Print the line at the specified index to the console,
     * but show the line number instead of index.
     * This is a debugging function
     */
    private printLine(index = this.index) {
        this.logDebug(
            (index + 1).toString().padStart(3, '0') + ':',
            this.lines[index]
        );
    }

    public async transpile(code: string) {
        var program = new Program({
            rootDir: `${__dirname}/rootDir`,
            files: [
                'source/main.brs'
            ],
            //use the current bsconfig
            ...(this.bsconfig ?? {})
        });
        var file = await program.addOrReplaceFile({ src: `${__dirname}/rootDir/source/main.bs`, dest: 'source/main.bs' }, code)
        await program.validate();
        let tranpileResult = file.transpile();
        return tranpileResult.code;
    }
}

(async () => {
    const docsFolder = path.resolve(
        path.join(__dirname, '..', 'docs')
    );
    const docs = glob.sync('**/*.md', {
        cwd: docsFolder,
        absolute: true
    });

    for (let docPath of docs) {
        console.log('\n', docPath);
        const compiler = new DocCompiler(docPath, enableDebugLogging);
        await compiler.run();
    }
})();