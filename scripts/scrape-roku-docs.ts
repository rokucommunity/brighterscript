/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable no-cond-assign */
import { JSDOM } from 'jsdom';
import * as phin from 'phin';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../src/util';
import { Parser } from '../src/parser/Parser';
import type { CallExpression, LiteralExpression } from '../src/parser/Expression';
import type { ExpressionStatement, FunctionStatement } from '../src/parser/Statement';
import TurndownService = require('turndown');
import { gfm } from 'turndown-plugin-gfm';
import type { TokensList, Tokens, Token } from 'marked';
import { lexer as markedLexer } from 'marked';
import * as he from 'he';

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

class ComponentListBuilder {
    private references: any;

    private result = {
        generatedDate: new Date().toISOString(),
        nodes: {} as Record<string, SceneGraphNode>,
        components: {} as Record<string, BrightScriptComponent>,
        interfaces: {} as Record<string, RokuInterface>,
        events: {} as Record<string, RokuInterface>
    };

    public async run() {
        const outPath = s`${__dirname}/../src/roku-types/data.json`;
        fsExtra.removeSync(outPath);
        loadCache();
        //load the base level roku docs data
        await this.loadReferences();

        //build the various types of docs
        await this.buildComponents();
        await this.buildInterfaces();
        await this.buildEvents();

        //certain references are missing hyperlinks. this attempts to repair them
        this.linkMissingReferences();

        //store the output
        fsExtra.outputFileSync(outPath, JSON.stringify(this.result, null, 4));
    }

    /**
     * Repair references that are missing a hyperlink (usually because the roku docs were incomplete)
     */
    public linkMissingReferences() {
        const refs = [
            //components
            ...Object.values(this.result.components).flatMap(x => x.interfaces),
            //interfaces
            ...Object.values(this.result.interfaces).flatMap(x => x.implementers),
            //events
            ...Object.values(this.result.events).flatMap(x => x.implementers)
        ];
        for (const ref of refs) {
            if (!ref.url) {
                ref.url = this.result.components[ref.name]?.url;
            }
        }
    }

    public buildRoSGNodeList() {
        // const asdf = this.httpGet('https://devtools.web.roku.com/schema/RokuSceneGraph.xsd');
    }

    private async buildComponents() {
        const componentDocs = this.references.BrightScript.Components;
        const count = Object.values(componentDocs).length;
        let i = 1;
        for (const name in componentDocs) {
            console.log(`Processing component ${i++} of ${count}`);
            const docPath = componentDocs[name];
            const docUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docUrl);
            const dom = await this.getDom(docUrl);
            const document = dom.window.document;

            const component = {
                name: manager.getHeading(1)?.text,
                url: getDocUrl(docPath),
                interfaces: manager.getListReferences('supported interfaces'),
                events: manager.getListReferences('supported events'),
                constructors: [],
                description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
            } as BrightScriptComponent;

            if (/this object is created with no parameters/.exec(manager.html)) {
                component.constructors.push({
                    params: [],
                    returnType: name,
                    returnDescription: undefined
                });
                //scan the text for the constructor signatures
            } else {

                //find all createObject calls
                const regexp = /CreateObject\(.*?\)/g;
                let match;
                while (match = regexp.exec(manager.markdown)) {
                    const { statements } = Parser.parse(match[0]);
                    if (statements.length > 0) {
                        const signature = {
                            params: [],
                            returnType: name
                        } as Signature;
                        const call = (statements[0] as ExpressionStatement).expression as CallExpression;
                        //only scan createObject calls for our own name
                        if ((call.args[0] as LiteralExpression)?.token?.text === `"${name}"`) {
                            //skip the first arg because that's the name of the component
                            for (let i = 1; i < call.args.length; i++) {
                                const arg = call.args[i];
                                signature.params.push({
                                    name: `param${i}`,
                                    default: undefined,
                                    isRequired: true,
                                    type: (arg as any).type?.toString() ?? 'dynamic',
                                    description: undefined
                                });
                            }
                            component.constructors.push(signature);
                        }
                    }
                }
            }
            this.reduceSignatures(component.constructors);

            //if there is a custom handler for this doc, call it
            if (this[name]) {
                console.log(`calling custom handler for ${name}`);
                this[name](component, document);
            }

            this.result.components[name] = component;
        }
    }

    private async buildInterfaces() {
        const interfaceDocs = this.references.BrightScript.Interfaces;
        const count = Object.values(interfaceDocs).length;
        let i = 1;
        for (const name in interfaceDocs) {
            console.log(`Processing interface ${i++} of ${count}`);
            const docPath = interfaceDocs[name];
            const docUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docUrl);

            try {

                const dom = await this.getDom(docUrl);
                const document = dom.window.document;

                const iface = {
                    name: name,
                    url: getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(manager),
                    properties: [],
                    implementers: this.getImplementers(manager),
                    description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                    availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
                } as RokuInterface;

                //if there is a custom handler for this doc, call it
                if (this[name]) {
                    console.log(`calling custom handler for ${name}`);
                    this[name](iface, document);
                }

                this.result.interfaces[name] = iface as any;
            } catch (e) {
                console.error(`Error processing interface ${docUrl}`, e);
            }
        }
    }

    private async buildEvents() {
        const eventDocs = this.references.BrightScript.Events;
        const count = Object.values(eventDocs).length;
        let i = 1;
        for (const name in eventDocs) {
            console.log(`Processing event ${i++} of ${count}`);
            const docPath = eventDocs[name];
            const docUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docUrl);
            try {

                const dom = await this.getDom(docUrl);
                const document = dom.window.document;

                const evt = {
                    name: name,
                    url: getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(manager),
                    properties: [],
                    implementers: this.getImplementers(manager),
                    description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                    availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
                } as RokuEvent;

                //if there is a custom handler for this doc, call it
                if (this[name]) {
                    console.log(`calling custom handler for ${name}`);
                    this[name](evt, document);
                }

                this.result.events[name] = evt as any;
            } catch (e) {
                console.error(`Error processing interface ${docUrl}`, e);
            }
        }
    }

    private getImplementers(manager: TokenManager) {
        const result = [] as Implementer[];

        //try to find a table from multiple different locations, keep the first one found
        const table = [
            manager.getHeading(2, 'implemented by'),
            //some roku docs incorrectly have the table nested inside the `Description` block instead
            manager.getHeading(2, 'description'),
            manager.getHeading(1)
        ].map(token => manager.getTableByHeaders(
            ['name', 'description'],
            token,
            x => x.type === 'heading' && x.depth === 2
        )).find(x => !!x);

        //some docs have the "implemented by" table in the "Description heading instead"
        if (!table) { }
        if (table?.type === 'table') {
            for (const row of table?.tokens?.cells ?? []) {
                const firstTokenInRow = row?.[0]?.[0];
                //find the link, or default to the cell itself (assume it's a text node?)
                const token = deepSearch(firstTokenInRow, 'type', (key, value) => value === 'link') ?? firstTokenInRow;
                result.push({
                    name: token.text,
                    description: he.decode((row?.[1]?.[0] as Tokens.Text).text ?? '') || undefined,
                    //if this is not a link, we'll just get back `undefined`, and we will repair this link at the end of the script
                    url: getDocUrl(token?.href)
                });
            }
        }
        return result;
    }

    private isTable(element) {
        return element?.nodeName?.toLowerCase() === 'table';
    }

    private reduceSignatures(signatures: Array<Signature>) {
        //remove duplicate signatures
        const keys = {};
        for (let i = signatures.length - 1; i >= 0; i--) {
            const signature = signatures[i];
            const paramKeys = signature.params.map(x => `${x.name}-${x.type}-${x.default}-${x.isRequired}`);
            const key = `${signature.returnType}-${paramKeys.join('-')}`;
            //if we already have this key, remove this signature from the list
            if (keys[key]) {
                signatures.splice(i, 1);
            } else {
                keys[key] = true;
            }
        }
    }

    /**
     * Custom handler for roAppManager
     * create a new interface called `AppManagerTheme`
     */
    private roAppManager(component: BrightScriptComponent, document: Document) {
        const iface = {
            name: 'AppManagerTheme',
            properties: [],
            implementers: [],
            methods: [],
            url: undefined
        } as RokuInterface;

        for (const row of this.getTableDataByHeaders(document, ['attribute', 'screen types', 'values', 'example', 'version'])) {
            iface.properties.push({
                name: row.attribute,
                description: `${row.values}. Screen types: ${row['screen types']}. Example: ${row.example}`,
                default: 'invalid',
                type: 'string'
            });
        }
        this.result.interfaces[iface.name] = iface;
    }

    private getTableByHeaders(document: Document, searchHeaders: string[], exclusive = false) {
        //find the attributes table
        return [...document.getElementsByTagName('table')].find(x => {
            const headerNames = [...x.getElementsByTagName('tr')?.[0].getElementsByTagName('th')].map(x => x.innerHTML.toLowerCase());

            //match all of the headers provided
            for (const searchHeader of searchHeaders) {
                if (!headerNames.includes(searchHeader)) {
                    return false;
                }
            }
            //enforce that the table ONLY has these headers
            if (exclusive) {
                for (const tableHeader of headerNames) {
                    if (!searchHeaders.includes(tableHeader)) {
                        return false;
                    }
                }
            }
            return true;
        });
    }

    private getTableDataByHeaders<T extends string, U = { [K in T]?: string }>(document: Document, searchHeaders: T[]) {
        return this.getTableData<U>(
            this.getTableByHeaders(document, searchHeaders)
        );
    }

    private getTableData<T>(table: any) {
        if (!this.isTable(table)) {
            console.error('Element is not a table', table);
            return [];
        }
        //get the header names
        const headerNames = [...table.getElementsByTagName('tr')?.[0].getElementsByTagName('th')].map(x => x.innerHTML.toLowerCase());
        const result = [] as Array<T>;
        for (const row of [...table.getElementsByTagName('tbody')[0].getElementsByTagName('tr')]) {
            const columns = [...row.getElementsByTagName('td')];
            const rowData = {} as T;
            for (let i = 0; i < columns.length; i++) {
                const column = columns[i];
                rowData[headerNames[i]] = column.innerHTML;
            }
            result.push(rowData);
        }
        return result;
    }

    private buildInterfaceMethods(manager: TokenManager) {
        const result = [] as Func[];
        //find every h3
        const methodHeaders = manager.getByType<Tokens.Heading>('heading').filter(x => x.depth === 3);
        for (let i = 0; i < methodHeaders.length; i++) {
            const methodHeader = methodHeaders[i];
            const nextMethodHeader = methodHeaders[i + 1];
            const method = this.getMethod(methodHeader.text);
            if (method) {
                method.description = manager.getNextToken<Tokens.Paragraph>(
                    manager.find(x => !!/description/i.exec(x?.text), methodHeader, nextMethodHeader)
                )?.text;

                method.returnDescription = manager.getNextToken<Tokens.Paragraph>(
                    manager.find(x => !!/return\s*value/i.exec(x?.text), methodHeader, nextMethodHeader)
                )?.text;

                //augment parameter info from optional parameters table
                const parameterObjects = manager.tableToObjects(
                    manager.getTableByHeaders(['name', 'type', 'description'], methodHeader, x => x === nextMethodHeader)
                );
                for (const row of parameterObjects ?? []) {
                    const methodParam = method.params.find(p => p?.name && p.name?.toLowerCase() === row.name?.toLowerCase());
                    if (methodParam) {
                        methodParam.type = row.type ?? methodParam.type;
                        methodParam.description = row.description ?? methodParam.description;
                    }
                }

                result.push(method);
            }
        }
        return result;
    }

    private getMethod(text: string) {
        // var state = new TranspileState(new BrsFile('', '', new Program({}));
        const { statements } = Parser.parse(`function ${text}\nend function`);
        if (statements.length > 0) {
            const func = statements[0] as FunctionStatement;
            return {
                name: func.name?.text,
                params: func.func.parameters.map(x => ({
                    name: x.name?.text,
                    isRequired: !x.defaultValue,
                    default: null, //x.defaultValue.transpile(state)
                    type: x.typeToken?.text
                })),
                returnType: func.func.returnTypeToken?.text
            } as Func;
        }
    }

    private async getDom(apiUrl: string) {
        const html = (await getJson(apiUrl)).content;
        const dom = new JSDOM(html);
        return dom;
    }

    private getDocApiUrl(docRelativePath: string) {
        return `https://developer.roku.com/api/v1/get-dev-cms-doc?locale=en-us&filePath=${docRelativePath.replace(/^\/docs\//, '')}`;
    }

    private async loadReferences() {
        const response = await getJson('https://developer.roku.com/api/v1/get-dev-cms-doc?filePath=left-nav%2Freferences.json&locale=en-us');
        this.references = JSON.parse(response.content);
    }
}

let cache: Record<string, string>;
function loadCache() {
    const cachePath = s`${__dirname}/.cache.json`;
    if (fsExtra.pathExistsSync(cachePath)) {
        cache = fsExtra.readJsonSync(cachePath);
    } else {
        cache = {};
    }
}

function saveCache() {
    fsExtra.writeJsonSync(s`${__dirname}/.cache.json`, cache);
}

async function getJson(url: string) {
    if (!cache[url]) {
        console.log('Fetching from web', url);
        cache[url] = (await phin(url)).body.toString();
        saveCache();
    } else {
        console.log('Fetching from cache', url);
    }
    return JSON.parse(cache[url]);
}

function getDocUrl(docRelativePath: string) {
    if (docRelativePath) {
        return `https://developer.roku.com/docs${docRelativePath}`;
    }
}

//run the builder
new ComponentListBuilder().run().catch((e) => console.error(e));

function deepSearch(object, key, predicate) {
    if (object.hasOwnProperty(key) && predicate(key, object[key]) === true) {
        return object;
    }

    for (let i = 0; i < Object.keys(object).length; i++) {
        let value = object[Object.keys(object)[i]];
        if (typeof value === 'object' && value) {
            let o = deepSearch(object[Object.keys(object)[i]], key, predicate);
            if (o) {
                return o;
            }
        }
    }
    return null;
}


/**
 * A class to help manage the parsed markdown tokens
 */
class TokenManager {
    public html: string;
    public markdown: string;
    public tokens: TokensList;

    public async process(url: string) {
        this.html = (await getJson(url)).content;
        this.markdown = turndownService.turndown(this.html);
        this.tokens = markedLexer(this.markdown);
        return this;
    }

    /**
     * Find a heading tag
     */
    public getHeading(depth: number, text?: string) {
        for (const token of this.tokens) {
            if (token?.type === 'heading' && token?.depth === depth) {
                //if we have a text filter, and the text does not match, then skip
                if (text && token?.text?.toLowerCase() !== text) {
                    continue;
                }
                return token;
            }
        }
    }

    /**
     * Scan the tokens and find the first the top-level table based on the header names
     */
    public getTableByHeaders(searchHeaders: string[], startAt: Token, endTokenMatcher?: EndTokenMatcher): TableEnhanced {
        let startIndex = this.tokens.indexOf(startAt);
        startIndex = startIndex > -1 ? startIndex : 0;

        for (let i = startIndex + 1; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            if (token?.type === 'table') {
                const headers = token?.header?.map(x => x.toLowerCase());
                if (
                    headers.every(x => searchHeaders.includes(x)) &&
                    searchHeaders.every(x => headers.includes(x))
                ) {
                    return token as TableEnhanced;
                }
            }
            if (endTokenMatcher?.(token) === true) {
                break;
            }
        }
    }

    /**
     * Convert a markdown table token into an array of objects with the headers as keys, and the cell values as values
     */
    public tableToObjects(table: Tokens.Table) {
        const result = [] as Record<string, string>[];
        const headers = table?.header?.map(x => x.toLowerCase());
        for (const row of table?.cells ?? []) {
            const data = {};
            for (let i = 0; i < headers.length; i++) {
                data[headers[i]] = row[i];
            }
            result.push(data);
        }
        return result;
    }

    /**
     * Get a list of `Reference` objects from a markdown list found immediately after a header
     */
    public getListReferences(headerText: string) {
        const result = [] as Reference[];
        const headerIndex = this.tokens.indexOf(
            this.tokens.find(x => (x as any).text?.toLowerCase() === headerText)
        );
        if (headerIndex > -1) {
            //the next token should be the list
            const list = this.tokens[headerIndex + 1];
            if (list?.type === 'list') {
                for (const item of list?.items ?? []) {
                    //find the link
                    const link = deepSearch(item, 'type', (key, value) => value === 'link');
                    result.push({
                        name: link.text,
                        url: getDocUrl(link.href)
                    });
                }
            }
        }
        return result;
    }

    /**
     * Get all tokens of the specified type from the top-level tokens list
     */
    public getByType<T extends Token>(type: Token['type']): T[] {
        const result = [] as T[];
        for (const token of this.tokens) {
            if (token.type === type) {
                result.push(token as T);
            }
        }
        return result;
    }

    /**
     * Find a token that matches, starting and stopping at given tokens if specified
     */
    public find<T extends Token = Token>(func: (x: any) => boolean | undefined, startAt?: Token, stopAt?: Token) {
        let startIndex = this.tokens.indexOf(startAt);
        startIndex = startIndex > -1 ? startIndex : 0;

        let stopIndex = this.tokens.indexOf(stopAt);
        stopIndex = stopIndex > -1 ? stopIndex : this.tokens.length;

        for (let i = startIndex; i < stopIndex; i++) {
            const token = this.tokens[i];
            if (func(token) === true) {
                return token as T;
            }
        }
    }

    /**
     * Get the token directly after the given token
     */
    public getNextToken<T extends Token = Token>(currentToken: Token) {
        let idx = this.tokens.indexOf(currentToken);
        if (idx > -1) {
            return this.tokens[idx + 1] as T;
        }
    }

    /**
     * Get all text found between the start token and the matched end token
     */
    public getTokensBetween(startToken: Token, endTokenMatcher: EndTokenMatcher) {
        let startIndex = this.tokens.indexOf(startToken);
        startIndex = startIndex > -1 ? startIndex : 0;

        const result = [] as Token[];

        for (let i = startIndex + 1; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            //stop collecting tokens once the matcher returns true
            if (endTokenMatcher(token) === true) {
                break;
            } else {
                result.push(token);
            }
        }
        return result;
    }

    /**
     * Get join all markdown between the specified items
     */
    public getMarkdown(startToken: Token, endTokenMatcher: EndTokenMatcher) {
        return this.getTokensBetween(startToken, endTokenMatcher).map(x => x.raw).join('')?.trim() || undefined;
    }

    /**
     * Find any `available since` text between the specified items
     */
    public getAvailableSince(startToken: Token, endTokenMatcher: EndTokenMatcher) {
        const markdown = this.getMarkdown(startToken, endTokenMatcher);
        const match = /available\s+since\s?(?:roku\s*os\s*)?([\d\.]+)/i.exec(markdown);
        if (match) {
            return match[1];
        }
    }
}

type EndTokenMatcher = (t: Token) => boolean | undefined;

interface TableEnhanced extends Tokens.Table {
    tokens: {
        header: Array<Array<TokensList>>;
        cells: Array<Array<TokensList>>;
    };
}

interface BrightScriptComponent {
    name: string;
    url: string;
    availableSince: string;
    description: string;
    constructors: Array<Signature>;
    interfaces: Reference[];
    events: Reference[];
}

interface SceneGraphNode {
    name: string;
    url: string;
    availableSince: string;
    description: string;
    constructors: Array<Signature>;
    interfaces: Reference[];
    events: Reference[];
}

interface Reference {
    name: string;
    url: string;
}

interface Implementer extends Reference {
    /**
     * A description of that this interface implementer does (i.e. describes a component)
     */
    description: string;
}

interface RokuInterface {
    availableSince: string;
    name: string;
    url: string;
    /**
     * Standard roku interfaces don't have properties, but we occasionally need to store properties
     * for complicated parameter values for certain methods
     */
    properties: Prop[];
    methods: Func[];
    implementers: Implementer[];
}

interface RokuEvent {
    availableSince: string;
    name: string;
    url: string;
    description: string;
    /**
     * Standard roku interfaces don't have properties, but we occasionally need to store properties
     * for complicated parameter values for certain methods
     */
    properties: Prop[];
    methods: Func[];
    implementers: Implementer[];
}

interface Func extends Signature {
    name: string;
    description: string;
}
interface Param {
    name: string;
    isRequired: boolean;
    description: string;
    default: string;
    type: string;
}
interface Prop {
    name: string;
    description: string;
    type: string;
    default: string;
}
interface Signature {
    params: Param[];
    returnType: string;
    returnDescription: string;
}
interface ElementFilter {
    id?: string;
    text?: string;
    type?: string;
    class?: string;
}
