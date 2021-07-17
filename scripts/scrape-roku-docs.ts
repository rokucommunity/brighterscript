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
import type { TokensList, Tokens } from 'marked';
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
        //components
        for (const component of Object.values(this.result.components)) {
            for (const ref of component.interfaces) {
                if (!ref.url) {
                    ref.url = this.result.interfaces[ref.name]?.url;
                }
            }
        }
        //interfaces
        for (const iface of Object.values(this.result.interfaces)) {
            for (const ref of iface.implementors ?? []) {
                if (!ref.url) {
                    ref.url = this.result.components[ref.name]?.url;
                }
            }
        }
    }

    public buildRoSGNodeList() {
        // const asdf = this.httpGet('https://devtools.web.roku.com/schema/RokuSceneGraph.xsd');
    }

    private getImplementors(manager: TokenManager) {
        const result = [] as Implementor[];
        const table = manager.getTableByHeaders(['name', 'description']);
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

            const descriptionEl = this.findNextElement(document.getElementsByTagName('h1')[0], { type: 'p' });

            const component = {
                name: manager.getHeading(1)?.text,
                url: getDocUrl(docPath),
                interfaces: manager.getListReferences('supported interfaces'),
                events: manager.getListReferences('supported events'),
                constructors: [],
                description: descriptionEl?.innerHTML
            } as BrightScriptComponent;

            if (document.body.innerHTML.match(/this object is created with no parameters/)) {
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
                while (match = regexp.exec(document.body.innerHTML)) {
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
                                    default: 'invalid',
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
                const descriptionEl = this.findNextElement(document.getElementsByTagName('h1')[0], { type: 'p' });

                const iface = {
                    name: name,
                    url: getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(document),
                    properties: [],
                    implementors: this.getImplementors(manager),
                    desription: descriptionEl?.innerHTML
                };

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
            try {

                const dom = await this.getDom(docUrl);
                const document = dom.window.document;
                const descriptionEl = this.findNextElement(document.getElementsByTagName('h1')[0], { type: 'p' });

                const evt = {
                    name: name,
                    url: getDocUrl(docPath),
                    description: descriptionEl?.innerHTML,
                    methods: this.buildInterfaceMethods(document),
                    properties: [],
                    implementors: this.getInterfaceImplementors(document)
                };

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

    private isTable(element) {
        return element?.nodeName?.toLowerCase() === 'table';
    }

    private getInterfaceImplementors(document: Document) {
        //there are serveral different ways the interface "implemented by" table can be found in the html, so get them all and keep the first one
        let table = [
            document.getElementById('implemented-by')?.nextElementSibling,
            document.getElementById('implemented-by')?.nextElementSibling?.firstElementChild,
            document.getElementById('implemented-by')?.nextElementSibling?.nextElementSibling,
            document.getElementById('implemented-by')?.nextElementSibling?.nextElementSibling?.firstElementChild,
            document.querySelectorAll('h1')[0]?.nextElementSibling,
            document.querySelectorAll('h1')[0]?.nextElementSibling?.firstElementChild,
            document.querySelectorAll('h1')[0]?.nextElementSibling?.nextElementSibling,
            document.querySelectorAll('h1')[0]?.nextElementSibling?.nextElementSibling?.firstElementChild,
            document.querySelectorAll('h1')[1]?.nextElementSibling,
            document.querySelectorAll('h1')[1]?.nextElementSibling?.firstElementChild,
            document.querySelectorAll('h1')[1]?.nextElementSibling?.nextElementSibling,
            document.querySelectorAll('h1')[1]?.nextElementSibling?.nextElementSibling?.firstElementChild,
            this.getTableByHeaders(document, ['name', 'description'], true)
        ].find(x => this.isTable(x));

        const result = this.getTableData<Implementor>(table).map((x) => {
            //some name columns are a hyperlink
            if (x.name?.trim().startsWith('<a')) {
                x.name = />(.*)?<\/a>/.exec(x.name)?.[1];
                x.url = /href\s*=\s*"(.*)?"/.exec(x.name)?.[1];
            }
            return x;
        });
        return result;
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
            implementors: [],
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
    private findNextElement<T = HTMLElement>(start: HTMLElement, matchFilter: ElementFilter, stopFilter?: ElementFilter): T {

        function doFilter(item: HTMLElement, filter) {
            return item?.id === filter?.id ||
                item?.textContent?.toLowerCase() === filter?.text ||
                item?.nodeName?.toString()?.toLowerCase() === filter?.type?.toLowerCase() ||
                item?.classList.contains(filter?.class);
        }

        let current = start;
        do {
            current = current?.nextElementSibling as HTMLElement;
            //return the first element that matches the filter
            if (doFilter(current, matchFilter)) {
                return current as unknown as T;
                //if we found a not-match filter, stop searching
            } else if (doFilter(current, stopFilter)) {
                return;
            }
        } while (current);
    }

    private buildInterfaceMethods(document: Document) {
        const result = [] as Func[];
        //the element right before the start of a method group
        let previous = document.getElementById('supported-methods');
        //let's hope all the interface methods are structured the same way!

        while (previous) {
            const signatureEl = this.findNextElement(previous, { type: 'h3' }, { id: 'toc-full' });
            const descriptionEl = [
                this.findNextElement(signatureEl, { text: 'description' }, { type: 'h3' })?.nextElementSibling,
                signatureEl?.nextElementSibling
            ].find(x => x?.nodeName?.toLowerCase() === 'p');
            const paramsTableEl = [
                this.findNextElement(signatureEl, { text: 'parameters' }, { type: 'h3' })?.nextElementSibling,
                this.findNextElement(signatureEl, { text: 'parameters' }, { type: 'h3' })?.nextElementSibling?.firstElementChild
            ].find(x => this.isTable(x));
            const returnValueEl = this.findNextElement(signatureEl, { text: 'return value' }, { type: 'h3' })?.nextElementSibling;
            if (signatureEl) {
                const method = this.getMethod(signatureEl.innerHTML);
                if (method) {
                    method.description = descriptionEl?.innerHTML;
                    if (paramsTableEl) {
                        const paramsFromTable = this.getTableData<{ name: string; type: string; description: string }>(paramsTableEl) ?? [];
                        //augment any scanned signature info with data from the table
                        for (const param of paramsFromTable) {
                            const methodParam = method.signatures[0].params.find(x => x?.name && param.name && x.name?.toLowerCase() === param.name?.toLowerCase());
                            if (methodParam) {
                                methodParam.name = param.name;
                                methodParam.type = param.type;
                                methodParam.description = param.description;
                            }
                        }
                    }
                    method.signatures[0].returnDescription = returnValueEl?.innerHTML;
                    result.push(method);
                }
            }

            previous = (returnValueEl ?? paramsTableEl?.parentElement ?? descriptionEl ?? signatureEl) as any;
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
                signatures: [{
                    params: func.func.parameters.map(x => ({
                        name: x.name?.text,
                        isRequired: !x.defaultValue,
                        default: null, //x.defaultValue.transpile(state)
                        type: x.typeToken?.text
                    })),
                    returnType: func.func.returnTypeToken?.text
                }]
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

interface Implementor extends Reference {
    /**
     * A description of that this interface implementor does (i.e. describes a component)
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
    implementors: Implementor[];
}

interface RokuEvent {
    availableSince: string;
    name: string;
    url: string;
    /**
     * Standard roku interfaces don't have properties, but we occasionally need to store properties
     * for complicated parameter values for certain methods
     */
    properties: Prop[];
    methods: Func[];
    implementors: Implementor[];
}

interface Func {
    name: string;
    description: string;
    signatures: Array<Signature>;
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
            if (token?.type === 'heading' && token?.depth === 1) {
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
    public getTableByHeaders(searchHeaders: string[]): TableEnhanced {
        for (const token of this.tokens) {
            if (token?.type === 'table') {
                const headers = token?.header?.map(x => x.toLowerCase());
                if (
                    headers.every(x => searchHeaders.includes(x)) &&
                    searchHeaders.every(x => headers.includes(x))
                ) {
                    return token as TableEnhanced;
                }
            }
        }
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
}

interface TableEnhanced extends Tokens.Table {
    tokens: {
        header: Array<Array<TokensList>>;
        cells: Array<Array<TokensList>>;
    };
}
