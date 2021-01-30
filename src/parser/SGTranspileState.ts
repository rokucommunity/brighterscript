import type { Range } from 'vscode-languageserver';
import { SourceNode } from 'source-map';
import type { SGToken } from './SGTypes';
import type { XmlFile } from '../files/XmlFile';

export class SGTranspileState {

    constructor(
        public file: XmlFile
    ) {
        this.file = file;

        //if a sourceRoot is specified, use that instead of the rootDir
        if (this.file.program.options.sourceRoot) {
            this.source = this.file.pathAbsolute.replace(
                this.file.program.options.rootDir,
                this.file.program.options.sourceRoot
            );
        } else {
            this.source = this.file.pathAbsolute;
        }
    }

    /**
     * The absolute path to the source location of this file. If sourceRoot is specified,
     * this path will be full path to the file in sourceRoot instead of rootDir.
     * If the file resides outside of rootDir, then no changes will be made to this path.
     */
    public source: string;
    indent = '';

    private _depth = 0;
    get blockDepth() {
        return this._depth;
    }
    set blockDepth(value: number) {
        this._depth = value;
        this.indent = value === 0 ? '' : '    '.repeat(value);
    }

    public rangeToSourceOffset(range: Range) {
        if (!range) {
            return {
                line: null,
                column: null
            };
        }
        return {
            line: range.start.line + 1,
            column: range.start.character
        };
    }

    public transpileToken(token: SGToken) {
        const { range, text } = token;
        if (!range) {
            return text;
        }
        const offset = this.rangeToSourceOffset(range);
        if (range.end.line > range.start.line) {
            //break multiline text
            const lines = text.split('\n');
            const first = lines.shift();
            const last = lines.length - 1;
            return new SourceNode(null, null, null, [
                new SourceNode(offset.line, offset.column, this.source, first + '\n'),
                ...lines.map((line, index) => new SourceNode(
                    offset.line + 1 + index, 1, this.source, index < last ? line + '\n' : line
                ))
            ]);
        } else {
            return new SourceNode(offset.line, offset.column, this.source, text);
        }
    }
}
