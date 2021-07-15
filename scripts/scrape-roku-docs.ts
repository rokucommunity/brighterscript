/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable no-cond-assign */
import { JSDOM } from 'jsdom';
import * as phin from 'phin';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../src/util';
import { Parser } from '../src/parser/Parser';
import type { CallExpression, LiteralExpression } from '../src/parser/Expression';
import type { ExpressionStatement, FunctionStatement } from '../src/parser/Statement';
import * as dedent from 'dedent';

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
        this.loadCache();
        //load the base level roku docs data
        await this.loadReferences();
        await this.buildComponents();
        await this.buildInterfaces();
        await this.buildEvents();

        //certain references are missing hyperlinks. this attempts to repair them
        this.linkMissingReferences();

        //store the output
        fsExtra.outputFileSync(outPath, JSON.stringify(this.result, null, 4));
    }

    /**
     * Repair missing urls
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

    private async buildComponents() {
        const componentDocs = this.references.BrightScript.Components;
        const count = Object.values(componentDocs).length;
        let i = 1;
        for (const name in componentDocs) {
            console.log(`Processing component ${i++} of ${count}`);
            const docPath = componentDocs[name];
            const dom = await this.getDom(this.getDocApiUrl(docPath));
            const document = dom.window.document;

            const component = {
                name: name,
                url: this.getDocUrl(docPath),
                interfaces: this.getUlData(document, 'supported-interfaces'),
                events: this.getUlData(document, 'supported-events'),
                constructors: []
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

    private async buildInterfaces() {
        const interfaceDocs = this.references.BrightScript.Interfaces;
        const count = Object.values(interfaceDocs).length;
        let i = 1;
        for (const name in interfaceDocs) {
            console.log(`Processing interface ${i++} of ${count}`);
            const docPath = interfaceDocs[name];
            const docUrl = this.getDocApiUrl(docPath);
            try {

                const dom = await this.getDom(docUrl);
                const document = dom.window.document;


                const iface = {
                    name: name,
                    url: this.getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(document),
                    properties: [],
                    implementors: this.getInterfaceImplementors(document)
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

                const evt = {
                    name: name,
                    url: this.getDocUrl(docPath),
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

    private getUlData(document: Document, elementId: string) {
        const result = [] as Reference[];
        //get "Supported Interfaces" element
        const header = document.getElementById(elementId);
        if (header) {
            //find the <ul> (there's a random #text node between them)
            const children = (header.nextSibling?.nextSibling as any)?.children ?? [];
            for (const child of children as Array<HTMLLIElement>) {
                result.push({
                    name: child.children[0].innerHTML,
                    url: this.getDocUrl(child.children[0].attributes.getNamedItem('href').value)
                });
            }
        }
        return result;
    }

    private async getJson(url: string) {
        if (!this.cache[url]) {
            console.log('Fetching from web', url);
            this.cache[url] = (await phin(url)).body.toString();
            this.saveCache();
        } else {
            console.log('Fetching from cache', url);
        }
        return JSON.parse(this.cache[url]);
    }

    private async getDom(apiUrl: string) {
        const html = (await this.getJson(apiUrl)).content;
        const dom = new JSDOM(html);
        return dom;
    }

    private getDocApiUrl(docRelativePath: string) {
        return `https://developer.roku.com/api/v1/get-dev-cms-doc?locale=en-us&filePath=${docRelativePath.replace(/^\/docs\//, '')}`;
    }

    private getDocUrl(docRelativePath: string) {
        return `https://developer.roku.com/en-ca${docRelativePath}`;
    }

    private async loadReferences() {
        const response = await this.getJson('https://developer.roku.com/api/v1/get-dev-cms-doc?filePath=left-nav%2Freferences.json&locale=en-us');
        this.references = JSON.parse(response.content);
    }

    private cache: Record<string, string>;
    private loadCache() {
        const cachePath = s`${__dirname}/.cache.json`;
        if (fsExtra.pathExistsSync(cachePath)) {
            this.cache = fsExtra.readJsonSync(cachePath);
        } else {
            this.cache = {};
        }
    }

    private saveCache() {
        fsExtra.writeJsonSync(s`${__dirname}/.cache.json`, this.cache);
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
