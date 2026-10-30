import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { AnchorNodeDeclaration, Value } from '../bscPlugin/fileProviders/AnchorNodeParser';
import { findAnchorNodeDeclarations, findImportSpecifiers, findObjectsWithKey, getString, tokenize, ValueParser } from '../bscPlugin/fileProviders/AnchorNodeParser';
import { standardizePath as s } from '../util';

/**
 * The parts of an RSG 2.0 SDK `roku-config.ts` that brighterscript cares about
 */
export interface RokuConfig {
    /**
     * The main TypeScript file of the app (`app.entryPoint`), relative to the roku-config file. `undefined` for BrightScript-only apps
     */
    entryPoint?: string;
    /**
     * The folder holding the manifest, `source/` and other static assets (`app.staticAssetsDir`), relative to the roku-config file
     */
    staticAssetsDir: string;
    /**
     * Is this a BrightScript-only app (`app.brsOnly`)
     */
    brsOnly: boolean;
}

/**
 * The default `app.staticAssetsDir` used by the SDK
 */
const DEFAULT_STATIC_ASSETS_DIR = './pkg';

/**
 * TypeScript extensions that are followed when resolving imports
 */
const typeScriptExtensions = ['.ts', '.tsx', '.mts'];

/**
 * Read a `roku-config.ts` file without running it. The SDK runs this file as code, but the values brighterscript
 * needs are plain string literals in practice, so they are read statically. Values that are computed are ignored.
 */
export function parseRokuConfig(text: string): RokuConfig {
    const tokens = tokenize(text ?? '');
    //the `app` object is the object that holds `entryPoint` (or `brsOnly`/`staticAssetsDir` for BrightScript-only apps)
    const objectStart = ['entryPoint', 'brsOnly', 'staticAssetsDir'].map(key => findObjectsWithKey(tokens, key)[0]).find(x => x !== undefined);
    const app = objectStart !== undefined ? new ValueParser(tokens, objectStart).parse() : undefined;
    const properties = app?.kind === 'object' ? app.properties : new Map<string, Value>();
    const brsOnly = properties.get('brsOnly');
    return {
        entryPoint: getString(properties.get('entryPoint')),
        staticAssetsDir: getString(properties.get('staticAssetsDir')) ?? DEFAULT_STATIC_ASSETS_DIR,
        brsOnly: brsOnly?.kind === 'reference' && brsOnly.name === 'true'
    };
}

/**
 * An anchor node found while discovering an RSG 2.0 project
 */
export interface DiscoveredAnchorNode extends AnchorNodeDeclaration {
    /**
     * The absolute path to the TypeScript file that declares this anchor node
     */
    srcPath: string;
}

export interface RsgProject {
    /**
     * The absolute path to the `roku-config.ts` file
     */
    rokuConfigPath: string;
    config: RokuConfig;
    /**
     * The absolute path to the app's TypeScript entry point (if it exists)
     */
    entryPoint?: string;
    /**
     * The absolute path to the folder holding the manifest, `source/` and other static assets
     */
    staticAssetsDir: string;
    /**
     * The absolute path of every TypeScript file reachable from the entry point through relative imports
     */
    sourceFiles: string[];
    /**
     * The absolute path of every XML component imported from TypeScript (the SDK copies these into `pkg:/components/`)
     */
    xmlComponentImports: string[];
    /**
     * Every anchor node declared in the source files
     */
    anchorNodes: DiscoveredAnchorNode[];
    /**
     * Problems found while discovering the project (i.e. a missing entry point)
     */
    problems: string[];
}

/**
 * Discover an RSG 2.0 SDK project from its `roku-config.ts`: read the config, then follow every relative import from the
 * entry point to find the TypeScript sources, the XML components they import, and the anchor nodes they declare.
 * Only files that the app can actually reach are read, so large projects (and node_modules) don't cost anything extra.
 */
export function discoverRsgProject(rokuConfigPath: string): RsgProject {
    rokuConfigPath = s`${rokuConfigPath}`;
    const configDir = path.dirname(rokuConfigPath);
    const configText = readFile(rokuConfigPath);
    const config = parseRokuConfig(configText);
    const result: RsgProject = {
        rokuConfigPath: rokuConfigPath,
        config: config,
        staticAssetsDir: s`${path.resolve(configDir, config.staticAssetsDir)}`,
        sourceFiles: [],
        xmlComponentImports: [],
        anchorNodes: [],
        problems: []
    };
    if (configText === undefined) {
        result.problems.push(`Could not read roku-config file '${rokuConfigPath}'`);
        return result;
    }
    if (config.brsOnly) {
        return result;
    }
    if (!config.entryPoint) {
        result.problems.push(`Could not find a string literal 'app.entryPoint' in '${rokuConfigPath}'`);
        return result;
    }
    const entryPoint = resolveTypeScriptFile(path.resolve(configDir, config.entryPoint));
    if (!entryPoint) {
        result.problems.push(`Entry point '${config.entryPoint}' from '${rokuConfigPath}' does not exist`);
        return result;
    }
    result.entryPoint = entryPoint;

    const visited = new Set<string>();
    const xmlImports = new Set<string>();
    const queue = [entryPoint];
    while (queue.length > 0) {
        const filePath = queue.shift();
        if (visited.has(filePath.toLowerCase())) {
            continue;
        }
        visited.add(filePath.toLowerCase());
        const text = readFile(filePath);
        if (text === undefined) {
            continue;
        }
        result.sourceFiles.push(filePath);
        for (const declaration of findAnchorNodeDeclarations(text)) {
            result.anchorNodes.push({ ...declaration, srcPath: filePath });
        }
        for (const specifier of findImportSpecifiers(text)) {
            //only relative imports are followed. Packages (i.e. `@roku-sdk/*`) and path aliases are not
            if (!specifier.startsWith('.')) {
                continue;
            }
            const importPath = path.resolve(path.dirname(filePath), specifier);
            if (/\.xml$/i.test(specifier)) {
                xmlImports.add(s`${importPath}`);
                continue;
            }
            const resolved = resolveTypeScriptFile(importPath);
            if (resolved) {
                queue.push(resolved);
            }
        }
    }
    result.xmlComponentImports = [...xmlImports];
    return result;
}

/**
 * Resolve an import path to a TypeScript file the way TypeScript would: as-is, with a TypeScript extension,
 * with a `.js` extension swapped for its TypeScript equivalent, or as a folder with an `index` file
 */
function resolveTypeScriptFile(importPath: string): string | undefined {
    const candidates = [importPath];
    const withoutJsExtension = importPath.replace(/\.(m?js|jsx)$/i, '');
    for (const extension of typeScriptExtensions) {
        candidates.push(withoutJsExtension + extension);
    }
    for (const extension of typeScriptExtensions) {
        candidates.push(path.join(importPath, 'index' + extension));
    }
    for (const candidate of candidates) {
        if (typeScriptExtensions.includes(path.extname(candidate).toLowerCase()) && !/\.d\.m?ts$/i.test(candidate) && isFile(candidate)) {
            return s`${candidate}`;
        }
    }
    return undefined;
}

function isFile(filePath: string) {
    try {
        return fsExtra.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function readFile(filePath: string): string | undefined {
    try {
        return fsExtra.readFileSync(filePath).toString();
    } catch {
        return undefined;
    }
}
