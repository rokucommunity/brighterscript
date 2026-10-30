/**
 * Words that are legal BrightScript identifiers but can't be used as TypeScript identifiers
 */
const reservedWords = new Set([
    'arguments', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
    'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
    'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static',
    'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield'
]);

/**
 * The type designator suffixes BrightScript allows on identifiers (`name$`, `count%`, ...). `$` can't appear anywhere
 * else in a BrightScript identifier, so these can never collide with a real name
 */
const suffixMap = {
    '$': '$s',
    '%': '$i',
    '!': '$f',
    '#': '$d',
    '&': '$l'
};

/**
 * BrightScript is case-insensitive and TypeScript isn't, so every identifier is lower-cased on the way in.
 * The original casing is restored in diagnostic messages by `TsTypeEngine`
 */
export function tsName(name: string): string {
    if (!name) {
        return name;
    }
    let result = name.toLowerCase();
    const suffix = suffixMap[result[result.length - 1]];
    if (suffix) {
        result = result.substring(0, result.length - 1) + suffix;
    }
    result = result.replace(/[^a-z0-9_$]/g, '_');
    if (reservedWords.has(result) || /^[0-9]/.test(result)) {
        result += '$$';
    }
    return result;
}

/**
 * Names of BrightScript's built-in types, mapped to the TypeScript type the prelude uses for them
 */
export const builtInTypeMap = new Map<string, string>([
    ['dynamic', 'any'],
    ['object', 'any'],
    ['string', 'string'],
    ['boolean', 'boolean'],
    ['integer', 'integer'],
    ['longinteger', 'longinteger'],
    ['float', 'float'],
    ['double', 'double'],
    ['void', 'void'],
    ['invalid', 'null'],
    ['uninitialized', 'undefined'],
    ['function', 'Function'],
    ['rosgnode', 'rosgnode']
]);
