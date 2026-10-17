import { SGFieldTypes } from '../../parser/SGTypes';

/**
 * A SceneGraph node declared from TypeScript through the RSG 2.0 SDK's `registerAnchorNode(declaration, render)` function.
 */
export interface AnchorNodeDeclaration {
    /**
     * The name of the SceneGraph component (i.e. `componentName` from the declaration)
     */
    componentName: string;
    /**
     * The name of the node this component extends (i.e. `extends` from the declaration)
     */
    extends?: string;
    fields: AnchorNodeField[];
}

export interface AnchorNodeField {
    name: string;
    /**
     * Was this field declared in `inputFields` or `outputFields`
     */
    direction: 'input' | 'output';
    /**
     * The SceneGraph xml field type (i.e. `boolean`, `stringarray`). `undefined` when the type could not be determined
     */
    type?: string;
}

/**
 * The name of the function that registers an anchor node
 */
const REGISTER_FUNCTION_NAME = 'registerAnchorNode';

/**
 * Aliases for `FieldType.<Name>()` names that are not themselves SceneGraph field types
 */
const fieldTypeAliases: Record<string, string> = {
    number: 'float',
    double: 'float',
    long: 'longinteger',
    aa: 'assocarray',
    associativearray: 'assocarray',
    object: 'assocarray',
    list: 'array',
    rect: 'rect2d',
    vector2: 'vector2d'
};

/**
 * The array form of a SceneGraph field type, used for `FieldType.Array(FieldType.String())`
 */
const arrayFieldTypes: Record<string, string> = {
    boolean: 'boolarray',
    integer: 'intarray',
    float: 'floatarray',
    string: 'stringarray',
    node: 'nodearray',
    color: 'colorarray',
    time: 'timearray',
    vector2d: 'vector2darray',
    rect2d: 'rect2darray'
};

/**
 * Find every `registerAnchorNode(...)` call in a TypeScript/JavaScript file and extract its declaration.
 * This is not a full TypeScript parser. It only understands declarations that are object literals,
 * either inline or in a variable declared in the same file. Anything it can't statically read is skipped.
 */
export function findAnchorNodeDeclarations(text: string): AnchorNodeDeclaration[] {
    //cheap check to skip the vast majority of files
    if (!text?.includes(REGISTER_FUNCTION_NAME)) {
        return [];
    }
    const tokens = tokenize(text);
    const result: AnchorNodeDeclaration[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind !== 'identifier' || token.text !== REGISTER_FUNCTION_NAME) {
            continue;
        }
        //skip the function definition itself (i.e. `function registerAnchorNode(`)
        const previous = tokens[i - 1];
        if (previous?.kind === 'identifier' && previous.text === 'function') {
            continue;
        }
        let index = i + 1;
        //skip type arguments (i.e. `registerAnchorNode<Foo>(`)
        if (tokens[index]?.text === '<') {
            index = skipBalanced(tokens, index);
        }
        if (tokens[index]?.text !== '(') {
            continue;
        }
        let value = new ValueParser(tokens, index + 1).parse();
        if (value.kind === 'reference') {
            value = findVariableValue(tokens, value.name);
        }
        const declaration = toDeclaration(value);
        if (declaration) {
            result.push(declaration);
        }
    }
    return result;
}

/**
 * Find the initial value of `const|let|var <name> = <value>` in the file
 */
function findVariableValue(tokens: Token[], name: string): Value {
    for (let i = 0; i < tokens.length - 1; i++) {
        const token = tokens[i];
        if (token.kind !== 'identifier' || !['const', 'let', 'var'].includes(token.text)) {
            continue;
        }
        if (tokens[i + 1].kind !== 'identifier' || tokens[i + 1].text !== name) {
            continue;
        }
        let index = i + 2;
        //skip any type annotation
        if (tokens[index]?.text === ':') {
            index = skipExpression(tokens, index + 1, ['=']);
        }
        if (tokens[index]?.text === '=') {
            return new ValueParser(tokens, index + 1).parse();
        }
    }
    return { kind: 'unknown' };
}

function toDeclaration(value: Value): AnchorNodeDeclaration | undefined {
    if (value.kind !== 'object') {
        return undefined;
    }
    const componentName = getString(value.properties.get('componentName'));
    //SceneGraph component names must be valid identifiers
    if (!componentName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(componentName)) {
        return undefined;
    }
    const declaration: AnchorNodeDeclaration = {
        componentName: componentName,
        extends: getString(value.properties.get('extends')),
        fields: []
    };
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
 * Get the SceneGraph field type for a field value such as `FieldType.Boolean()` or `'boolean'`
 */
function getFieldType(value: Value): string | undefined {
    let typeName: string;
    if (value?.kind === 'call') {
        typeName = value.callee[value.callee.length - 1];
    } else if (value?.kind === 'string') {
        typeName = value.value;
    } else {
        return undefined;
    }
    typeName = typeName.toLowerCase();
    typeName = fieldTypeAliases[typeName] ?? typeName;
    if (!SGFieldTypes.includes(typeName)) {
        return undefined;
    }
    //`FieldType.Array(FieldType.String())` becomes `stringarray`
    if ((typeName === 'array' || typeName === 'roarray') && value.kind === 'call') {
        const itemType = getFieldType(value.args[0]);
        if (itemType && arrayFieldTypes[itemType]) {
            return arrayFieldTypes[itemType];
        }
    }
    return typeName;
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
