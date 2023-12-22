import type { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { BscFile, BsDiagnostic, CommentFlag, DiagnosticCode } from './interfaces';
import { util } from './util';

export class CommentFlagProcessor {
    public constructor(
        /**
         * The file this processor applies to
         */
        public file: BscFile,
        /**
         * An array of strings containing the types of text that a comment starts with. (i.e. `REM`, `'`, `<!--`)
         */
        public commentStarters = [] as string[],
        /**
         * Valid diagnostic codes. Codes NOT in this list will be flagged
         */
        public diagnosticCodes = [] as DiagnosticCode[],
        /**
         * Diagnostic codes to never filter (these codes will always be flagged)
         */
        public ignoreDiagnosticCodes = [] as DiagnosticCode[]
    ) {

        this.allCodesExceptIgnores = this.diagnosticCodes.filter(x => !this.ignoreDiagnosticCodes.includes(x));

    }

    /**
     * List of comment flags generated during processing
     */
    public commentFlags = [] as CommentFlag[];

    /**
     * List of diagnostics generated during processing
     */
    public diagnostics = [] as BsDiagnostic[];

    /**
     * A list of all codes EXCEPT the ones in `ignoreDiagnosticCodes`
     */
    public allCodesExceptIgnores: DiagnosticCode[];

    public tryAdd(text: string, range: Range) {
        const tokenized = this.tokenize(text, range);
        if (!tokenized) {
            return;
        }

        let affectedRange: Range;
        if (tokenized.disableType === 'line') {
            affectedRange = util.createRange(range.start.line, 0, range.start.line, range.start.character);
        } else {
            // tokenized.disableType must be 'next-line'
            affectedRange = util.createRange(range.start.line + 1, 0, range.start.line + 1, Number.MAX_SAFE_INTEGER);
        }

        let commentFlag: CommentFlag | null = null;

        //statement to disable EVERYTHING
        if (tokenized.codes.length === 0) {
            commentFlag = {
                file: this.file,
                //null means all codes
                codes: null,
                range: range,
                affectedRange: affectedRange
            };

            //disable specific diagnostic codes
        } else {
            let codes = [] as DiagnosticCode[];
            for (let codeToken of tokenized.codes) {
                let codeInt = parseInt(codeToken.code);
                //is a plugin-contributed or non-numeric code
                if (isNaN(codeInt)) {
                    codes.push(codeToken.code?.toString()?.toLowerCase());

                    //validate numeric codes against the list of known bsc codes
                } else if (this.diagnosticCodes.includes(codeInt)) {
                    codes.push(codeInt);

                    //add a warning for unknown codes
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.unknownDiagnosticCode(codeInt),
                        file: this.file,
                        range: codeToken.range
                    });
                }
            }
            if (codes.length > 0) {
                commentFlag = {
                    file: this.file,
                    codes: codes,
                    range: range,
                    affectedRange: affectedRange
                };
            }
        }

        if (commentFlag) {
            this.commentFlags.push(commentFlag);

            //add an ignore for everything in this comment except for Unknown_diagnostic_code_1014
            this.commentFlags.push({
                affectedRange: commentFlag.range,
                range: commentFlag.range,
                codes: this.allCodesExceptIgnores,
                file: this.file
            });
        }
    }

    /**
     * Small tokenizer for bs:disable comments
     */
    private tokenize(text: string, range: Range): DisableToken | null {
        let lowerText = text.toLowerCase();
        let offset = 0;
        let commentTokenText: string | null = null;

        for (const starter of this.commentStarters) {
            if (text.startsWith(starter)) {
                commentTokenText = starter;
                offset = starter.length;
                lowerText = lowerText.substring(commentTokenText.length);
                break;
            }
        }

        let disableType: 'line' | 'next-line';
        //trim leading/trailing whitespace
        let len = lowerText.length;
        lowerText = lowerText.trimLeft();
        offset += len - lowerText.length;
        if (lowerText.startsWith('bs:disable-line')) {
            lowerText = lowerText.substring('bs:disable-line'.length);
            offset += 'bs:disable-line'.length;
            disableType = 'line';
        } else if (lowerText.startsWith('bs:disable-next-line')) {
            lowerText = lowerText.substring('bs:disable-next-line'.length);
            offset += 'bs:disable-next-line'.length;
            disableType = 'next-line';
        } else {
            return null;
        }

        //discard the colon
        if (lowerText.startsWith(':')) {
            lowerText = lowerText.substring(1);
            offset += 1;
        }

        let items = this.tokenizeByWhitespace(lowerText);
        let codes = [] as Array<{ code: string; range: Range }>;
        for (let item of items) {
            codes.push({
                code: item.text,
                range: util.createRange(
                    range.start.line,
                    range.start.character + offset + item.startIndex,
                    range.start.line,
                    range.start.character + offset + item.startIndex + item.text.length
                )
            });
        }

        return {
            commentTokenText: commentTokenText,
            disableType: disableType,
            codes: codes
        };
    }

    /**
     * Given a string, extract each item split by whitespace
     * @param text the text to tokenize
     */
    private tokenizeByWhitespace(text: string): Token[] {

        let tokens = [] as Array<Token>;
        let currentToken: Token | null = null;

        for (let i = 0; i < text.length; i++) {
            let char = text[i];
            //if we hit whitespace
            if (char === ' ' || char === '\t') {
                if (currentToken) {
                    tokens.push(currentToken);
                    currentToken = null;
                }

                //we hit non-whitespace
            } else {
                if (!currentToken) {
                    currentToken = {
                        startIndex: i,
                        text: ''
                    };
                }
                currentToken.text += char;
            }
        }
        if (currentToken) {
            tokens.push(currentToken);
        }
        return tokens;
    }
}

interface Token {
    startIndex: number;
    text: string;
}

interface DisableToken {
    commentTokenText: string | null;
    disableType: 'line' | 'next-line';
    codes: {
        code: string;
        range: Range;
    }[];
}
