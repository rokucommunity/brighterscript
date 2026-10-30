import { components, interfaces, nodes } from '../roku-types';
import type { BRSComponentData, BRSInterfaceData, SGNodeData } from '../roku-types';
import { globalCallables } from '../globalCallables';
import type { BscType } from '../types/BscType';
import { isArrayType, isBooleanType, isDoubleType, isDynamicType, isFloatType, isFunctionType, isIntegerType, isInvalidType, isLongIntegerType, isObjectType, isStringType, isTypedFunctionType, isUnionType, isVoidType, isAssociativeArrayType } from '../astUtils/reflection';
import { tsName } from './naming';

/**
 * The virtual path of the shared declarations file that every scope's TypeScript program includes
 */
export const PRELUDE_PATH = '/bsc/$prelude.d.ts';

/**
 * Hand-written part of the prelude: the BrightScript primitive types, the helpers the emitter lowers
 * BrightScript operators and statements into, and the handful of globals TypeScript requires when `noLib` is on.
 *
 * Everything the emitter invents starts with `$` so it can never collide with a BrightScript identifier.
 */
const coreDeclarations = `
//the brands are optional, so all the numeric types stay assignable to each other (like BrightScript) but keep their own names in messages
type integer = number & { readonly $integer?: never };
type longinteger = number & { readonly $longinteger?: never };
type float = number & { readonly $float?: never };
type double = number & { readonly $double?: never };

type $IsAny<T> = 0 extends (1 & T) ? true : false;
type $Num = number;
type $Addable = number | string;
type $AddRhs<A> = $IsAny<A> extends true ? any : A extends string ? string : number;
type $Result<A, B, R> = $IsAny<A> extends true ? any : $IsAny<B> extends true ? any : R;
type $AddResult<A, B> = $Result<A, B, A extends string ? string : number>;

/** BrightScript '+': numbers add, strings concatenate, mixing the two is an error */
declare function $add<A extends $Addable, B extends $AddRhs<A>>(a: A, b: B): $AddResult<A, B>;
/** BrightScript '-', '*', '/', '\\', 'mod', '^', '<<', '>>' */
declare function $arith<A extends $Num, B extends $Num>(a: A, b: B): $Result<A, B, number>;
/** BrightScript '<', '<=', '>', '>=' */
declare function $compare<A extends $Addable, B extends $AddRhs<A>>(a: A, b: B): boolean;
/** BrightScript unary '-' */
declare function $negate<A extends $Num>(a: A): $Result<A, A, number>;
/** Associative array literals keep their known members and also allow any other key, like BrightScript */
declare function $aa<T>(value: T): T & roassociativearray;
/** 'for each' over arrays, associative arrays (keys) and anything dynamic */
declare function $iterate<T>(value: T[]): T[];
declare function $iterate(value: roassociativearray): string[];
declare function $iterate(value: {}): any[];
/** The 'to' and 'step' values of a counting 'for' loop */
declare function $forCondition(finalValue: number, step?: number): boolean;
declare function $callfunc(node: any, methodName: string, ...args: any[]): any;
declare function $template(...values: any[]): string;
declare const $unknown: any;

/** 'm' outside of a class method is the dynamic component/global associative array */
declare var m: any;

interface Array<T> {
    [index: number]: T;
    count(): integer;
    push(value: T): void;
    pop(): T;
    shift(): T;
    unshift(value: T): void;
    peek(): T;
    append(values: T[]): void;
    getentry(index: integer): T;
    setentry(index: integer, value: T): void;
}
interface Boolean { }
interface Function { }
interface IArguments { }
interface Number { }
interface Object { }
interface RegExp { }
interface String { }
interface CallableFunction extends Function { }
interface NewableFunction extends Function { }
`;

/**
 * Convert one of the type strings found in the roku-types docs data into TypeScript
 */
function docTypeToTs(typeText: string): string {
    const text = (typeText ?? '').toLowerCase().replace(/\*|\[|\]|\(.*?\)/g, '').trim();
    if (text.includes(' or ')) {
        return text.split(' or ').map(docTypeToTs).join(' | ');
    }
    if (/^array|^roarray/.test(text)) {
        return 'any[]';
    }
    switch (text) {
        case 'string':
        case 'uri':
        case 'url':
        case 'color':
        case 'option string':
        case 'value string':
        case 'option as string':
            return 'string';
        case 'integer':
        case 'int':
            return 'integer';
        case 'long':
        case 'longinteger':
            return 'longinteger';
        case 'float':
        case 'time':
            return 'float';
        case 'double':
            return 'double';
        case 'boolean':
        case 'bool':
            return 'boolean';
        case 'void':
            return 'void';
        case 'function':
            return 'Function';
        case 'associative array':
        case 'assocarray':
        case 'roassociativearray':
            return 'roassociativearray';
        case 'node':
        case 'rosgnode':
            return 'rosgnode';
        default:
            if (text.endsWith(' node')) {
                return 'rosgnode';
            }
            if (components[text]) {
                return text;
            }
            return 'any';
    }
}

/**
 * Convert a built-in BscType (as used by the global callables) into TypeScript
 */
export function bscTypeToTs(type: BscType): string {
    if (!type) {
        return 'any';
    } else if (isIntegerType(type)) {
        return 'integer';
    } else if (isLongIntegerType(type)) {
        return 'longinteger';
    } else if (isFloatType(type)) {
        return 'float';
    } else if (isDoubleType(type)) {
        return 'double';
    } else if (isStringType(type)) {
        return 'string';
    } else if (isBooleanType(type)) {
        return 'boolean';
    } else if (isVoidType(type)) {
        return 'void';
    } else if (isInvalidType(type)) {
        return 'null';
    } else if (isDynamicType(type) || isObjectType(type)) {
        return 'any';
    } else if (isAssociativeArrayType(type)) {
        return 'roassociativearray';
    } else if (isArrayType(type)) {
        return `(${bscTypeToTs(type.defaultType)})[]`;
    } else if (isUnionType(type)) {
        return type.types.map(x => bscTypeToTs(x)).join(' | ');
    } else if (isTypedFunctionType(type) || isFunctionType(type)) {
        return 'Function';
    }
    return 'any';
}

interface MethodLike {
    name: string;
    params: Array<{ name: string; type: string; isRequired: boolean }>;
    returnType: string;
    isVariadic?: boolean;
}

function methodToTs(method: MethodLike) {
    const params = method.params.map((param, i) => {
        return `${tsName(param.name) || `p${i}`}${param.isRequired ? '' : '?'}: ${docTypeToTs(param.type)}`;
    });
    if (method.isVariadic) {
        params.push('...rest: any[]');
    }
    return `    ${tsName(method.name)}(${params.join(', ')}): ${docTypeToTs(method.returnType)};`;
}

/**
 * Get the methods of every interface a built-in component implements, flattened into a single member list.
 * Flattening (rather than `extends`) sidesteps conflicts between interfaces that declare the same method differently
 */
function getComponentMembers(componentName: string): string[] {
    const members: string[] = [];
    const component = components[componentName] as BRSComponentData;
    for (const iface of component?.interfaces ?? []) {
        for (const method of (interfaces[iface.name.toLowerCase()] as BRSInterfaceData)?.methods ?? []) {
            members.push(methodToTs(method));
        }
    }
    return members;
}

function getNodeFields(nodeName: string, seen = new Set<string>()): string[] {
    const node = nodes[nodeName] as SGNodeData & { extends?: { name: string } };
    if (!node || seen.has(nodeName)) {
        return [];
    }
    seen.add(nodeName);
    const result: string[] = [];
    const parentName = node.extends?.name?.toLowerCase();
    if (parentName) {
        result.push(...getNodeFields(parentName, seen));
    }
    for (const field of node.fields ?? []) {
        result.push(`    ${tsName(field.name)}: ${docTypeToTs(field.type)};`);
    }
    return result;
}

function dedupe(members: string[]) {
    //fields can only be declared once, but methods are allowed to repeat (they become overloads)
    const seenFields = new Set<string>();
    return members.filter(member => {
        const fieldMatch = /^\s*([\w$]+):/.exec(member);
        if (fieldMatch) {
            if (seenFields.has(fieldMatch[1])) {
                return false;
            }
            seenFields.add(fieldMatch[1]);
        }
        return true;
    });
}

let preludeCache: string;

/**
 * Build the declarations file shared by every scope. It's static, so it's only built once per process
 */
export function getPrelude(): string {
    if (preludeCache) {
        return preludeCache;
    }
    const parts = [coreDeclarations];

    //intrinsic types get the methods of their boxed component, merged into TypeScript's global interfaces
    const intrinsics = {
        String: ['rostring'],
        Number: ['roint', 'rofloat', 'rodouble', 'rolonginteger'],
        Boolean: ['roboolean'],
        Function: ['rofunction']
    };
    for (const [tsInterface, componentNames] of Object.entries(intrinsics)) {
        const members = componentNames.flatMap(x => getComponentMembers(x));
        parts.push(`interface ${tsInterface} {\n${members.join('\n')}\n}`);
    }
    parts.push(`interface Array<T> {\n${getComponentMembers('roarray').join('\n')}\n}`);

    //all other built-in components
    const componentMap: string[] = [];
    for (const componentName of Object.keys(components)) {
        componentMap.push(`    ${componentName}: ${componentName};`);
        if (componentName === 'roarray') {
            parts.push(`interface roarray extends Array<any> { }`);
            continue;
        }
        const members = dedupe(getComponentMembers(componentName));
        if (componentName === 'roassociativearray' || componentName === 'rosgnode') {
            //these allow any key, so members we don't know about are dynamic
            members.unshift('    [key: string]: any;');
        }
        parts.push(`interface ${componentName} {\n${members.join('\n')}\n}`);
    }
    parts.push(`interface $components {\n${componentMap.join('\n')}\n}`);

    //SceneGraph nodes are roSGNode plus the fields of the node (and its ancestors)
    const nodeMap: string[] = [];
    for (const nodeName of Object.keys(nodes)) {
        if (!/^\w+$/.test(nodeName)) {
            //the docs data has a few non-node entries (eg. "key definition file")
            continue;
        }
        const typeName = `rosgnode${nodeName}`;
        nodeMap.push(`    ${nodeName}: ${typeName};`);
        parts.push(`interface ${typeName} extends rosgnode {\n${dedupe(getNodeFields(nodeName)).join('\n')}\n}`);
    }
    parts.push(`interface $nodes {\n${nodeMap.join('\n')}\n}`);

    //CreateObject knows the type of every built-in component and node, keyed on the (lower-cased) name
    parts.push(`
declare function createobject<N extends keyof $nodes>(name: 'rosgnode', nodeName: N): $nodes[N];
declare function createobject(name: 'rosgnode', nodeName: string): rosgnode;
declare function createobject<K extends keyof $components>(name: K, ...args: any[]): $components[K];
`);

    //every other global function
    for (const callable of globalCallables) {
        const name = tsName(callable.name);
        if (name === 'createobject') {
            continue;
        }
        const params = callable.params.map((param, i) => {
            const paramName = /^[a-z_]/i.test(param.name) ? tsName(param.name) : `p${i}`;
            if (param.isRestArgument) {
                return `...${paramName}: any[]`;
            }
            return `${paramName}${param.isOptional ? '?' : ''}: ${bscTypeToTs(param.type)}`;
        });
        parts.push(`declare function ${name}(${params.join(', ')}): ${bscTypeToTs(callable.type?.returnType)};`);
    }
    preludeCache = parts.join('\n');
    return preludeCache;
}
