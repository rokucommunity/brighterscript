import * as fsExtra from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';
import { util } from '../src/util';
import { Program } from '../src/Program';

class DocCompiler {
    private docsFolder = path.resolve(path.join(__dirname, '..', 'docs'));
    public async run() {

        var docs = glob.sync('**/*.md', {
            cwd: this.docsFolder,
            absolute: true
        });

        for (let docPath of docs) {
            console.log('\n', docPath);
            await this.processDoc(docPath);
        }
    }

    private lines: string[];
    private index: number;

    public async processDoc(docPath: string) {
        let contents = fsExtra.readFileSync(docPath).toString();
        this.lines = util.splitIntoLines(contents);
        this.index = 0;
        while (this.index < this.lines.length) {
            let line = this.lines[this.index];
            if (line.includes('```')) {
                await this.processCodeBlock();
            }
            this.index++;
        }

        var result = this.lines.join('\n');
        fsExtra.writeFileSync(docPath, result);
        delete this.lines;
        this.index = -1;
    }

    public async processCodeBlock() {
        var sourceLines = [] as string[];
        var sourceStartIndex = this.index + 1;
        var sourceStopIndex: number;

        //find the rest of the source code block
        //+1 to step past the opening ```
        for (var i = this.index + 1; i < this.lines.length; i++) {
            let line = this.lines[i];
            if (line.includes('```')) {
                sourceStopIndex = i - 1;
                break;
            } else {
                sourceLines.push(line);
            }
        }

        let sourceCode = sourceLines.join('\n');

        var transpiledStartIndex: number;
        var transpiledStopIndex: number;
        //find the transpiled code block (there must be one after every
        //+2 to step past the last line of code, and the final ```
        outer: for (var i = sourceStopIndex + 2; i < this.lines.length; i++) {
            let line = this.lines[i];
            //the next code block MUST be a brightscript block. hard-fail if it isn't
            if (line.includes('```')) {
                if (line.toLowerCase().includes('```brightscript')) {
                    //+1 to step past the opening ```brighterscript
                    transpiledStartIndex = i + 1;

                    //consume until the trailing ```
                    for (let j = transpiledStartIndex; j < this.lines.length; j++) {
                        let innerLine = this.lines[j];
                        if (innerLine.includes('```')) {
                            transpiledStopIndex = j;
                            break outer;
                        }
                    }
                } else {
                    throw new Error(`Could not find a transpiled code block for source code at line ${sourceStartIndex}`);
                }
            }
        }

        //now that we have the range for the transpiled code, we need to transpile the source code
        if (transpiledStartIndex && transpiledStopIndex && sourceCode) {
            console.log(`Transpiling code block at lines ${sourceStartIndex}-${sourceStopIndex}`);
            var transpiledCode = await this.transpile(sourceCode);
            let transpiledLines = transpiledCode.split('\n');
            let originalTranspiledLineCount = transpiledStopIndex - transpiledStartIndex

            //replace the old transpiled lines with the new ones
            this.lines.splice(
                transpiledStartIndex,
                originalTranspiledLineCount,
                ...transpiledLines
            );
            //set the index to the location past the trailing ```
            this.index = transpiledStopIndex - originalTranspiledLineCount + transpiledLines.length + 2;
        }
    }

    public async transpile(code: string) {
        var program = new Program({
            rootDir: `${__dirname}/rootDir`,
            files: [
                'source/main.brs'
            ]
        });
        var file = await program.addOrReplaceFile({ src: `${__dirname}/rootDir/source/main.bs`, dest: 'source/main.bs' }, code)
        await program.validate();
        let tranpileResult = file.transpile();
        return tranpileResult.code;
    }
}

new DocCompiler().run()
    .then(
        console.log.bind(console)
    ).catch(
        console.error.bind(console)
    );
