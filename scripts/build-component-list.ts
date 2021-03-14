import { JSDOM } from 'jsdom';
import * as phin from 'phin';
import { parse as parseJsonc } from 'jsonc-parser';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../src/util';


class ComponentListBuilder {
    private references: any;

    private result = {
        components: {} as Record<string, Component>,
        interfaces: {} as Record<string, RokuInterface>
    };

    public async run() {
        const outPath = s`${__dirname}/../src/roku-types/data.json`;
        fsExtra.removeSync(outPath);
        this.loadCache();
        //load the base level roku docs data
        await this.loadReferences();
        await this.buildComponents();

        //store the output
        fsExtra.outputFileSync(outPath, JSON.stringify(this.result, null, 4));
    }

    public buildRoSGNodeList() {
        // const asdf = this.httpGet('https://devtools.web.roku.com/schema/RokuSceneGraph.xsd');
    }

    private async buildComponents() {
        const interfaceDocs = this.references.BrightScript.Components;
        const count = Object.values(interfaceDocs).length;
        let i = 1;
        for (const name in interfaceDocs) {
            console.log(`Processing component ${i++} of ${count}`);
            const docPath = interfaceDocs[name];
            const dom = await this.getDom(this.getDocApiUrl(docPath));
            const document = dom.window.document;

            const component = {
                name: name,
                url: this.getDocUrl(docPath),
                interfaces: this.getUlData(document, 'supported-interfaces'),
                events: this.getUlData(document, 'supported-events'),
                parameters: []
            } as Component;

            //if there is a custom handler for this doc, call it
            if (this[name]) {
                console.log(`calling custom handler for ${name}`);
                this[name](component, document);
            }

            this.result.components[name] = component;
        }
    }

    /**
     * Custom handler for roAppManager
     * create a new interface called `AppManagerTheme`
     */
    private roAppManager(component: Component, document: Document) {
        const iface = {
            name: 'AppManagerTheme',
            properties: []
        } as RokuInterface;

        for (const row of this.getTableData(document, ['attribute', 'screen types', 'values', 'example', 'version'])) {
            iface.properties.push({
                name: row.attribute,
                description: `${row.values}. Screen types: ${row['screen types']}. Example: ${row.example}`,
                default: 'invalid',
                type: 'string'
            });
        }
        this.result.interfaces[iface.name] = iface;
    }

    private getTableByHeaders(document: Document, searchHeaders: string[]) {
        //find the attributes table
        return [...document.getElementsByTagName('table')].find(x => {
            //does this table have a header called "Attribute"?
            const headerNames = [...x.getElementsByTagName('tr')?.[0].getElementsByTagName('th')].map(x => x.innerHTML.toLowerCase());

            //match all of the headers provided
            for (const searchHeader of searchHeaders) {
                if (!headerNames.includes(searchHeader)) {
                    return false;
                }
            }
            return true;
        });
    }

    private getTableData<T extends string, U = { [K in T]?: string }>(document: Document, searchHeaders: T[]) {
        const table = this.getTableByHeaders(document, searchHeaders);
        //get the header names
        const headerNames = [...table.getElementsByTagName('tr')?.[0].getElementsByTagName('th')].map(x => x.innerHTML.toLowerCase());
        const result = [] as Array<U>;
        for (const row of [...table.getElementsByTagName('tbody')[0].getElementsByTagName('tr')]) {
            const columns = [...row.getElementsByTagName('td')];
            const rowData = {} as U;
            for (let i = 0; i < columns.length; i++) {
                const column = columns[i];
                rowData[headerNames[i]] = column.innerHTML;
            }
            result.push(rowData);
        }
        return result;
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

interface Component {
    name: string;
    url: string;
    parameters: Param[];
    interfaces: Reference[];
    events: Reference[];
}

interface Reference {
    name: string;
    url: string;
}

interface RokuInterface {
    name: string;
    url: string;
    properties: Prop[];
    methods: Func[];
}

interface Func {
    name: string;
    parameters: Param[];
}
interface Param {
    name: string;
    isRequred: boolean;
    default: string;
    type: string;
}
interface Prop {
    name: string;
    description: string;
    type: string;
    default: string;
}

//run the builder
new ComponentListBuilder().run().catch((e) => console.error(e));
