import type { Range } from 'vscode-languageserver';
import { SourceNode } from 'source-map';
import type { SGAttribute, SGToken } from './SGTypes';

export class SGTranspileState {

    indent = '';

    private _depth = 0;
    get blockDepth() {
        return this._depth;
    }
    set blockDepth(value: number) {
        this._depth = value;
        this.indent = value === 0 ? '' : '    '.repeat(value);
    }

    constructor(public source: string) {}

    private rangeToSourceOffset(range: Range) {
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

    transpileToken(token: SGToken) {
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

    transpileAttributes(attributes: SGAttribute[]): (string | SourceNode)[] {
        const result = [];
        attributes.forEach(attr => {
            const offset = this.rangeToSourceOffset(attr.range);
            result.push(
                ' ',
                new SourceNode(
                    offset.line,
                    offset.column,
                    this.source,
                    [
                        attr.key.text,
                        '="',
                        attr.value.text,
                        '"'
                    ])
            );
        });
        return result;
    }
}
