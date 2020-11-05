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
        if (range) {
            const offset = this.rangeToSourceOffset(range);
            return new SourceNode(offset.line, offset.column, this.source, text);
        } else {
            return text;
        }
    }

    transpileAttributes(attributes: SGAttribute[]): (string | SourceNode)[] {
        return attributes.map(attr => {
            const offset = this.rangeToSourceOffset(attr.range);
            return new SourceNode(
                offset.line,
                offset.column,
                this.source,
                [
                    ' ',
                    attr.key.text,
                    '="',
                    attr.value.text,
                    '"'
                ]);
        });
    }
}
