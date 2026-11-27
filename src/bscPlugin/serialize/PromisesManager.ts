import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { BeforeBuildProgramEvent } from '../../interfaces';
import { standardizePath as s } from '../../util';
import { Cache } from '../../Cache';
import { BrsFile } from '../../files/BrsFile';
import { AssetFile } from '../../files/AssetFile';
import { Parser, ParseMode } from '../../parser/Parser';
import { WalkMode } from '../../astUtils/visitors';
import { isAssignmentStatement, isCallExpression, isForEachStatement, isFunctionExpression, isFunctionStatement, isLiteralString, isVariableExpression } from '../../astUtils/reflection';
import type { Token } from '../../lexer/Token';
import type { FunctionExpression } from '../../parser/Expression';
import type { AstNode } from '../../parser/AstNode';

const promisesPackageDir = path.dirname(require.resolve('@rokucommunity/promises/package.json'));
const promisesSrcPath = s`${promisesPackageDir}/dist/source/promises.brs`;
const promisesComponentSrcPath = s`${promisesPackageDir}/dist/components/Promise.xml`;

/**
 * Where the embedded copy of the promises library's `Promise` component is written
 */
export const embeddedPromisesComponentPkgPath = s`components/promises/Promise.xml`;

/**
 * Manages the `@rokucommunity/promises` library, which powers async functions. When any file has an async function, it's added
 * to the build (and, like bslib, imported into every component) unless the project already has a copy of its own (i.e. installed by
 * ropm into `roku_modules`)
 */
export class PromisesManager {

    private cache = new Cache<string, BrsFile | AssetFile>();

    public addPromisesFilesIfMissing(event: BeforeBuildProgramEvent) {
        const { program } = event;
        //only projects that use async functions need the library
        if (!program.hasAsyncFunctions) {
            return;
        }
        const promisesPkgPath = program.promisesPkgPath;
        const promisesPkgPathLower = promisesPkgPath.toLowerCase();
        //is the promises library present in the program? If not, add it now just for this build cycle
        const exists = !!event.files.find(x => {
            return PromisesManager.isPromisesPkgPath(x.pkgPath) || x.pkgPath?.toLowerCase() === promisesPkgPathLower;
        });
        if (exists) {
            return;
        }
        const prefix = program.promisesPrefix;
        const file = this.cache.getOrAdd(`promises:${promisesPkgPath}`, () => {
            const file = new BrsFile({
                srcPath: promisesSrcPath,
                destPath: promisesPkgPath,
                pkgPath: promisesPkgPath,
                program: program
            });
            file.parse(
                PromisesManager.applyPrefix(fsExtra.readFileSync(promisesSrcPath).toString(), prefix)
            );
            return file;
        });
        event.files.push(file);

        //the library creates `Promise` nodes, so its component ships alongside it. It's static markup, so it's copied as an asset
        //rather than an XmlFile (which would also get the usual script imports injected into it)
        const componentFile = this.cache.getOrAdd(`component:${embeddedPromisesComponentPkgPath}`, () => {
            return new AssetFile({
                srcPath: promisesComponentSrcPath,
                destPath: embeddedPromisesComponentPkgPath,
                pkgPath: embeddedPromisesComponentPkgPath,
                data: Buffer.from(
                    PromisesManager.applyComponentPrefix(fsExtra.readFileSync(promisesComponentSrcPath).toString(), prefix)
                )
            });
        });
        event.files.push(componentFile);
    }

    /**
     * Add the prefix to every function in the promises library, every reference to those functions, and the `Promise` component name
     * it creates. This matches what ropm does when it installs the library (i.e. `chain()` becomes `promises_chain()`)
     */
    public static applyPrefix(source: string, prefix: string) {
        const { ast } = Parser.parse(source, { mode: ParseMode.BrightScript });
        const prefixLower = `${prefix}_`.toLowerCase();
        const functionNames = new Set<string>();
        for (const statement of ast.statements) {
            if (isFunctionStatement(statement)) {
                functionNames.add(statement.tokens.name.text.toLowerCase());
            }
        }
        const isUnprefixedFunctionName = (name: string) => {
            const lowerName = name.toLowerCase();
            return functionNames.has(lowerName) && !lowerName.startsWith(prefixLower);
        };

        const edits = [] as Array<{ token: Token; text: string }>;
        const localNamesCache = new Map<FunctionExpression, Set<string>>();
        ast.walk((node) => {
            if (isFunctionStatement(node) && isUnprefixedFunctionName(node.tokens.name.text)) {
                edits.push({ token: node.tokens.name, text: `${prefix}_${node.tokens.name.text}` });

                //references to the library's functions (calls, and functions passed as values)
            } else if (isVariableExpression(node) && isUnprefixedFunctionName(node.tokens.name.text)) {
                //skip any local variable that happens to share the name of a function
                const func = node.findAncestor<FunctionExpression>(isFunctionExpression);
                if (!PromisesManager.getLocalNames(func, localNamesCache).has(node.tokens.name.text.toLowerCase())) {
                    edits.push({ token: node.tokens.name, text: `${prefix}_${node.tokens.name.text}` });
                }

                //`createObject("roSGNode", "Promise")`
            } else if (
                isCallExpression(node) &&
                isVariableExpression(node.callee) && node.callee.tokens.name.text.toLowerCase() === 'createobject' &&
                isLiteralString(node.args[0]) && node.args[0].tokens.value.text.toLowerCase() === '"rosgnode"' &&
                isLiteralString(node.args[1]) && node.args[1].tokens.value.text === '"Promise"'
            ) {
                edits.push({ token: node.args[1].tokens.value, text: `"${prefix}_Promise"` });
            }
        }, {
            walkMode: WalkMode.visitAllRecursive
        });

        //apply the edits from the end of the file to the start, so earlier offsets stay valid
        edits.sort((a, b) => b.token.startPosition - a.token.startPosition);
        let result = source;
        for (const edit of edits) {
            result = result.substring(0, edit.token.startPosition) + edit.text + result.substring(edit.token.endPosition);
        }
        return result;
    }

    /**
     * Get the lower case names of every parameter and variable declared directly within a function
     */
    private static getLocalNames(func: FunctionExpression, cache: Map<FunctionExpression, Set<string>>) {
        let names = cache.get(func);
        if (!names) {
            names = new Set<string>();
            for (const param of func?.parameters ?? []) {
                names.add(param.tokens.name.text.toLowerCase());
            }
            func?.body?.walk((node: AstNode) => {
                if (isAssignmentStatement(node)) {
                    names.add(node.tokens.name.text.toLowerCase());
                } else if (isForEachStatement(node)) {
                    names.add(node.tokens.item.text.toLowerCase());
                }
                //`visitAll` does not step into nested functions, whose variables belong to them instead
            }, { walkMode: WalkMode.visitAll });
            cache.set(func, names);
        }
        return names;
    }

    /**
     * Rename the `Promise` component to match the prefixed name the library creates (i.e. `promises_Promise`)
     */
    public static applyComponentPrefix(source: string, prefix: string) {
        return source
            .replace(/(<component\s+name\s*=\s*")Promise(")/i, `$1${prefix}_Promise$2`)
            //the package's source map isn't copied, so drop the comment that points to it
            .replace(/\s*<!--\s*\/\/# sourceMappingURL=.*?-->\s*$/, '\n');
    }

    /**
     * Is the pkgPath a path to one of the ropm-installed copies of the promises library?
     */
    public static isPromisesPkgPath(pkgPath: string) {
        return /(^|[\\\/])source[\\\/]roku_modules[\\\/](rokucommunity_)?promises[\\\/]promises\.brs$/i.test(pkgPath ?? '');
    }

    /**
     * Is the pkgPath a path to the promises library's `Promise` component (the embedded copy or a ropm-installed one)?
     */
    public static isPromisesComponentPkgPath(pkgPath: string) {
        return /(^|[\\\/])components[\\\/]((roku_modules[\\\/](rokucommunity_)?)?promises)[\\\/]Promise\.xml$/i.test(pkgPath ?? '');
    }
}
