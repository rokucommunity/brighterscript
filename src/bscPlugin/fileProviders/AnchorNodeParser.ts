/**
 * A SceneGraph node declared from TypeScript through the RSG 2.0 SDK (an "anchor node").
 * The SDK describes these with a descriptor object that is passed to `defineAnchorNode`, `registerAnchorNode` or `declareTsComponent`:
 * `{ componentName: 'ViewOne', extends: 'Group', inputFields: { ... }, outputFields: { ... } }`
 */
export interface AnchorNodeDeclaration {
    /**
     * The name of the SceneGraph component (i.e. `componentName` from the descriptor)
     */
    componentName: string;
    /**
     * The name of the node this component extends (i.e. `extends` from the descriptor)
     */
    extends?: string;
    /**
     * The name of the component library this component belongs to (i.e. `libraryName` from the descriptor)
     */
    libraryName?: string;
    fields: AnchorNodeField[];
    /**
     * The zero-based line and character where the descriptor object starts
     */
    position: { line: number; character: number };
}

export interface AnchorNodeField {
    name: string;
    /**
     * Was this field declared in `inputFields` or `outputFields`
     */
    direction: 'input' | 'output';
    /**
     * The SceneGraph xml field type (i.e. `boolean`, `integer`). `undefined` when the type could not be determined
     */
    type?: string;
}

/**
 * The SceneGraph field type for each `FieldType.<Name>()` from the SDK. The device picks the field type
 * from the default value: numbers are integers unless declared with `Float`, and `null` is an object field
 */
const fieldTypes: Record<string, string> = {
    boolean: 'boolean',
    number: 'integer',
    float: 'float',
    string: 'string',
    array: 'array',
    object: 'assocarray',
    null: 'assocarray'
};

/**
 * Descriptor keys other than `componentName`. A descriptor must have at least one of these
 */
const descriptorKeys = ['extends', 'inputFields', 'outputFields'];

/**
 * Find every anchor node descriptor in a TypeScript/JavaScript file.
 * Descriptors are found by their shape (an object literal with a `componentName` string and at least one of
 * `extends`, `inputFields` or `outputFields`), wherever they are declared, so it doesn't matter which function
 * they are eventually passed to, or whether that happens in another file.
 * This is not a full TypeScript parser. Anything it can't statically read is skipped.
 */
export function findAnchorNodeDeclarations(text: string): AnchorNodeDeclaration[] {
    //cheap checks to skip the vast majority of files
    if (!text?.includes('componentName') || !/@roku-sdk\/|\bFieldType\b|\b(defineAnchorNode|registerAnchorNode|declareTsComponent)\b/.test(text)) {
        return [];
    }
    const tokens = tokenize(text);
    const result: AnchorNodeDeclaration[] = [];
    //the index of the `{` token of every object (or block) we are currently inside of
    const openBraces = [] as number[];
    const visited = new Set<number>();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.text === '{') {
            openBraces.push(i);
        } else if (token.text === '}') {
            openBraces.pop();
        } else if (token.kind === 'identifier' && token.text === 'componentName' && tokens[i + 1]?.text === ':' && openBraces.length > 0) {
            const objectStart = openBraces[openBraces.length - 1];
            if (visited.has(objectStart)) {
                continue;
            }
            visited.add(objectStart);
            const declaration = toDeclaration(new ValueParser(tokens, objectStart).parse(), getPosition(text, tokens[objectStart].offset));
            if (declaration) {
                result.push(declaration);
            }
        }
    }
    return result;
}

function getPosition(text: string, offset: number) {
    const before = text.substring(0, offset);
    const line = before.split('\n').length - 1;
    return { line: line, character: offset - (before.lastIndexOf('\n') + 1) };
}

function toDeclaration(value: Value, position: AnchorNodeDeclaration['position']): AnchorNodeDeclaration | undefined {
    if (value.kind !== 'object') {
        return undefined;
    }
    const componentName = getString(value.properties.get('componentName'));
    //SceneGraph component names must be valid identifiers
    if (!componentName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(componentName)) {
        return undefined;
    }
    if (!descriptorKeys.some(key => value.properties.has(key))) {
        return undefined;
    }
    const declaration: AnchorNodeDeclaration = {
        componentName: componentName,
        extends: getString(value.properties.get('extends')),
        fields: [],
        position: position
    };
    const libraryName = getString(value.properties.get('libraryName'));
    if (libraryName) {
        declaration.libraryName = libraryName;
    }
    for (const [key, direction] of [['inputFields', 'input'], ['outputFields', 'output']] as const) {
        const fields = value.properties.get(key);
        if (fields?.kind !== 'object') {
            continue;
        }
        for (const [name, fieldValue] of fields.properties) {
            declaration.fields.push({
                name: name,
                direction: direction,
                type: getFieldType(fieldValue)
            });
        }
    }
    return declaration;
}

function getString(value: Value): string | undefined {
    return value?.kind === 'string' ? value.value : undefined;
}

/**
 * Get the SceneGraph field type for a field value such as `FieldType.Boolean()`
 */
function getFieldType(value: Value): string | undefined {
    if (value?.kind !== 'call') {
        return undefined;
    }
    return fieldTypes[value.callee[value.callee.length - 1].toLowerCase()];
}

type Value =
    | { kind: 'string'; value: string }
    | { kind: 'object'; properties: Map<string, Value> }
    | { kind: 'array'; items: Value[] }
    | { kind: 'call'; callee: string[]; args: Value[] }
    | { kind: 'reference'; name: string }
    | { kind: 'unknown' };

/**
 * Reads the static parts of a JavaScript expression (object/array literals, strings, references and calls)
 */
class ValueParser {
    constructor(
        private tokens: Token[],
        public index: number
    ) { }

    public parse(): Value {
        let value = this.parsePrimary();
        //skip type assertions and non-null assertions (i.e. `as const`, `satisfies Foo`, `foo!`)
        for (;;) {
            const token = this.tokens[this.index];
            if (token?.kind === 'identifier' && (token.text === 'as' || token.text === 'satisfies')) {
                this.index = skipExpression(this.tokens, this.index + 1, [',', ')', ']', '}', ';']);
            } else if (token?.text === '!') {
                this.index++;
            } else {
                break;
            }
        }
        //anything else (i.e. `a + b`, `cond ? a : b`) can't be statically read
        if (!this.isAtExpressionEnd()) {
            this.index = skipExpression(this.tokens, this.index, [',', ')', ']', '}', ';']);
            return { kind: 'unknown' };
        }
        return value;
    }

    private isAtExpressionEnd() {
        const token = this.tokens[this.index];
        return !token || [',', ')', ']', '}', ';'].includes(token.text);
    }

    private parsePrimary(): Value {
        const token = this.tokens[this.index];
        if (!token) {
            return { kind: 'unknown' };
        }
        if (token.kind === 'string') {
            this.index++;
            return { kind: 'string', value: token.value };
        }
        if (token.text === '{') {
            return this.parseObject();
        }
        if (token.text === '[') {
            return this.parseArray();
        }
        if (token.text === '(') {
            //parenthesized expression
            this.index++;
            const value = this.parse();
            if (this.tokens[this.index]?.text === ')') {
                this.index++;
                return value;
            }
            return { kind: 'unknown' };
        }
        if (token.kind === 'identifier') {
            return this.parseReferenceOrCall();
        }
        this.index = skipExpression(this.tokens, this.index, [',', ')', ']', '}', ';']);
        return { kind: 'unknown' };
    }

    private parseReferenceOrCall(): Value {
        const path = [this.tokens[this.index].text];
        this.index++;
        while (this.tokens[this.index]?.text === '.' && this.tokens[this.index + 1]?.kind === 'identifier') {
            path.push(this.tokens[this.index + 1].text);
            this.index += 2;
        }
        //skip type arguments (i.e. `FieldType.Node<Foo>()`)
        if (this.tokens[this.index]?.text === '<') {
            const afterTypeArgs = skipBalanced(this.tokens, this.index);
            if (this.tokens[afterTypeArgs]?.text === '(') {
                this.index = afterTypeArgs;
            }
        }
        if (this.tokens[this.index]?.text === '(') {
            this.index++;
            const args = this.parseList(')');
            return { kind: 'call', callee: path, args: args };
        }
        if (path.length === 1) {
            return { kind: 'reference', name: path[0] };
        }
        return { kind: 'unknown' };
    }

    /**
     * Parse comma-separated values until the closing token. Assumes the opening token was already consumed
     */
    private parseList(closingText: string): Value[] {
        const items: Value[] = [];
        while (this.index < this.tokens.length && this.tokens[this.index].text !== closingText) {
            const startIndex = this.index;
            if (this.tokens[this.index].text === '...') {
                this.index = skipExpression(this.tokens, this.index + 1, [',', closingText]);
            } else {
                items.push(this.parse());
            }
            if (this.tokens[this.index]?.text === ',') {
                this.index++;
            } else if (this.tokens[this.index]?.text !== closingText) {
                //something we don't understand. bail out of this list
                this.index = skipExpression(this.tokens, this.index, [closingText]);
            }
            //an unmatched closing bracket (i.e. the scanner got confused by JSX) would otherwise stop all progress
            if (this.index <= startIndex) {
                this.index = startIndex + 1;
            }
        }
        //consume the closing token
        this.index++;
        return items;
    }

    private parseArray(): Value {
        this.index++;
        return { kind: 'array', items: this.parseList(']') };
    }

    private parseObject(): Value {
        this.index++;
        const properties = new Map<string, Value>();
        while (this.index < this.tokens.length && this.tokens[this.index].text !== '}') {
            const startIndex = this.index;
            const keyToken = this.tokens[this.index];
            const nextToken = this.tokens[this.index + 1];
            if ((keyToken.kind === 'identifier' || keyToken.kind === 'string' || keyToken.kind === 'number') && nextToken?.text === ':') {
                this.index += 2;
                properties.set(keyToken.kind === 'string' ? keyToken.value : keyToken.text, this.parse());
            } else {
                //spreads, computed keys, methods, shorthand properties, etc. are skipped
                this.index = skipExpression(this.tokens, this.index, [',', '}']);
            }
            if (this.tokens[this.index]?.text === ',') {
                this.index++;
            } else if (this.tokens[this.index]?.text !== '}') {
                this.index = skipExpression(this.tokens, this.index, ['}']);
            }
            //an unmatched closing bracket (i.e. the scanner got confused by JSX) would otherwise stop all progress
            if (this.index <= startIndex) {
                this.index = startIndex + 1;
            }
        }
        //consume the closing brace
        this.index++;
        return { kind: 'object', properties: properties };
    }
}

const closingBrackets: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>'
};

/**
 * Starting at an opening bracket, return the index of the token after its matching closing bracket
 */
function skipBalanced(tokens: Token[], index: number) {
    const stack = [] as string[];
    for (; index < tokens.length; index++) {
        const text = tokens[index].text;
        if (closingBrackets[text]) {
            stack.push(closingBrackets[text]);
        } else if (text === stack[stack.length - 1]) {
            stack.pop();
            if (stack.length === 0) {
                return index + 1;
            }
        }
    }
    return index;
}

/**
 * Skip tokens until one of the terminators is found outside of any brackets (or an unmatched closing bracket is found).
 * Returns the index of the terminator.
 */
function skipExpression(tokens: Token[], index: number, terminators: string[]) {
    let depth = 0;
    for (; index < tokens.length; index++) {
        const text = tokens[index].text;
        if (depth === 0 && terminators.includes(text)) {
            return index;
        }
        if (text === '(' || text === '[' || text === '{') {
            depth++;
        } else if (text === ')' || text === ']' || text === '}') {
            if (depth === 0) {
                return index;
            }
            depth--;
        }
    }
    return index;
}

interface Token {
    kind: 'identifier' | 'string' | 'number' | 'punctuation';
    text: string;
    /**
     * The offset of the start of this token in the text
     */
    offset?: number;
    /**
     * The value of a string token (without quotes, escapes resolved)
     */
    value?: string;
}

/**
 * Keywords after which a `/` starts a regular expression rather than a division
 */
const regexPrecedingKeywords = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/**
 * A forgiving JavaScript/TypeScript tokenizer. It only needs to be good enough to find object literals,
 * so it doesn't understand JSX. Strings and regular expressions never span lines, so any confusion
 * (such as an apostrophe in JSX text) only affects the rest of that line.
 */
function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const isIdentifierStart = (char: string) => /[A-Za-z_$]/.test(char) || char > '\x7f';
    const isIdentifierPart = (char: string) => /[A-Za-z0-9_$]/.test(char) || char > '\x7f';

    while (i < text.length) {
        const char = text[i];
        const next = text[i + 1];
        const tokenStart = i;
        const tokenCount = tokens.length;

        //whitespace
        if (/\s/.test(char)) {
            i++;

            //line comment
        } else if (char === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }

            //block comment
        } else if (char === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 2;

            //string
        } else if (char === '\'' || char === '"') {
            let value = '';
            i++;
            while (i < text.length && text[i] !== char && text[i] !== '\n') {
                if (text[i] === '\\') {
                    i++;
                }
                value += text[i] ?? '';
                i++;
            }
            i++;
            tokens.push({ kind: 'string', text: char, value: value });

            //template string. Only templates without substitutions are treated as strings
        } else if (char === '`') {
            let value = '';
            let hasSubstitution = false;
            let braceDepth = 0;
            i++;
            while (i < text.length && (text[i] !== '`' || braceDepth > 0)) {
                if (text[i] === '\\') {
                    i++;
                } else if (text[i] === '$' && text[i + 1] === '{') {
                    hasSubstitution = true;
                    braceDepth++;
                    i++;
                } else if (braceDepth > 0 && text[i] === '{') {
                    braceDepth++;
                } else if (braceDepth > 0 && text[i] === '}') {
                    braceDepth--;
                }
                value += text[i] ?? '';
                i++;
            }
            i++;
            if (hasSubstitution) {
                tokens.push({ kind: 'punctuation', text: '`' });
            } else {
                tokens.push({ kind: 'string', text: '`', value: value });
            }

            //regex literal
        } else if (char === '/' && isRegexAllowed(tokens[tokens.length - 1])) {
            i++;
            let inClass = false;
            while (i < text.length && text[i] !== '\n' && (text[i] !== '/' || inClass)) {
                if (text[i] === '\\') {
                    i++;
                } else if (text[i] === '[') {
                    inClass = true;
                } else if (text[i] === ']') {
                    inClass = false;
                }
                i++;
            }
            i++;
            //flags
            while (i < text.length && isIdentifierPart(text[i])) {
                i++;
            }
            tokens.push({ kind: 'punctuation', text: '/regex/' });

            //identifier or keyword
        } else if (isIdentifierStart(char)) {
            const start = i;
            while (i < text.length && isIdentifierPart(text[i])) {
                i++;
            }
            tokens.push({ kind: 'identifier', text: text.substring(start, i) });

            //number
        } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next))) {
            const start = i;
            while (i < text.length && /[0-9A-Za-z_.]/.test(text[i])) {
                i++;
            }
            tokens.push({ kind: 'number', text: text.substring(start, i) });

            //multi-character punctuation we care about
        } else if (text.startsWith('...', i)) {
            tokens.push({ kind: 'punctuation', text: '...' });
            i += 3;
        } else if (char === '=' && next === '>') {
            tokens.push({ kind: 'punctuation', text: '=>' });
            i += 2;
        } else {
            tokens.push({ kind: 'punctuation', text: char });
            i++;
        }
        if (tokens.length > tokenCount) {
            tokens[tokens.length - 1].offset = tokenStart;
        }
    }
    return tokens;
}

function isRegexAllowed(previous: Token) {
    if (!previous) {
        return true;
    }
    if (previous.kind === 'identifier') {
        return regexPrecedingKeywords.has(previous.text);
    }
    if (previous.kind === 'punctuation') {
        //`</Tag>` is a JSX closing tag, not a regex
        return !['<', ')', ']', '}', '/regex/', '`'].includes(previous.text);
    }
    return false;
}
