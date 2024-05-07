/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable no-cond-assign */
import * as phin from 'phin';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../src/util';
import { ParseMode, Parser } from '../src/parser/Parser';
import type { CallExpression, LiteralExpression } from '../src/parser/Expression';
import type { ExpressionStatement, FunctionStatement } from '../src/parser/Statement';
import TurndownService = require('turndown');
import { gfm } from '@guyplusplus/turndown-plugin-gfm';
import { marked } from 'marked';
import * as he from 'he';
import * as deepmerge from 'deepmerge';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { isVariableExpression } from '../src/astUtils/reflection';
import { SymbolTable } from '../src/SymbolTable';
import { SymbolTypeFlag } from '../src/SymbolTypeFlag';
import { referenceTypeFactory } from '../src/types/ReferenceType';
import { unionTypeFactory } from '../src/types/UnionType';


type Token = marked.Token;

const potentialTypes = ['object', 'integer', 'float', 'boolean', 'string', 'dynamic', 'function', 'longinteger', 'double', 'roassociativearray', 'object (string array)'];

const foundTypesTranslation = {
    'object (string array)': 'object',
    'robytearray object': 'roByteArray',
    'rolist of roassociativearray items': 'roList',
    'roassociative array': 'roAssociativeArray'
};

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

class Runner {
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

        SymbolTable.referenceTypeFactory = referenceTypeFactory;
        SymbolTable.unionTypeFactory = unionTypeFactory;
        loadCache();
        //load the base level roku docs data
        await this.loadReferences();

        //build the various types of docs
        await this.buildComponents();
        await this.buildInterfaces();
        await this.buildEvents();
        await this.buildNodes();

        //include hand-written overrides that were missing from roku docs, or were wrong from roku docs.
        this.mergeOverrides();

        //certain references are missing hyperlinks. this attempts to repair them
        this.repairReferences();
        this.linkMissingImplementers();

        //sort arrays internal to the data
        this.sortInternalData();

        //this.writeTypeDefinitions();

        //store the output
        fsExtra.outputFileSync(outPath, JSON.stringify(this.result, objectKeySorter, 4));
    }

    /**
     * Write a type definition file (.d.bs)
     */
    private writeTypeDefinitions() {
        let data = [] as string[];
        for (const iface of Object.values(this.result.interfaces)) {
            //TODO: Ideally this would use the getTypeDef() method of InterfaceStatement, but that does not include comments

            //add a single space between interface declarations
            data.push('');
            if (iface.availableSince) {
                //doc block
                data.push(
                    ``,
                    `'`,
                    `'@since ${iface.availableSince}`,
                    `'`
                );
            }
            data.push(`interface ${iface.name}`);

            for (const prop of iface.properties) {
                data.push(`\t${prop.name} as ${prop.type}`);
            }
            for (const method of iface.methods) {
                //method doc block
                data.push(`\t'`);

                if (method.description) {
                    data.push(
                        `\t'${method.description}`,
                        `\t'`
                    );
                }
                for (const param of method.params) {
                    let paramName = param.name;
                    if (param.default) {
                        paramName += `=${param.default}`;
                    }
                    if (!param.isRequired) {
                        paramName = `[${paramName}]`;
                    }
                    let paramComment = `\t'@param {${param.type}} ${paramName}`;
                    if (param.description) {
                        paramComment += ` ${param.description}`;
                    }
                    data.push(paramComment);
                }
                if (method.returnDescription) {
                    data.push(
                        method.returnDescription ? `\t'@return ${method.returnDescription}` : undefined,
                        `\t'`
                    );
                }

                const params = method.params.map(p => `${p.name} as ${p.type}`).join(', ');

                data.push(`\tfunction ${method.name}(${params}) as ${method.returnType}`);
            }
            data.push(`end interface`);
        }
        const result = data.filter(x => x !== undefined).join('\n');
        fsExtra.outputFileSync(__dirname + '/../lib/global.d.bs', result);
    }

    /**
     * Repair references that are missing a hyperlink (usually because the roku docs were incomplete),
     * or references that still have the relative doc path rather than the full url
     */
    public repairReferences() {
        console.log('Repairing relative references');
        //convert relative references to full URLs
        const refs = [
            //components
            ...Object.values(this.result.components).flatMap(x => x.interfaces),
            ...Object.values(this.result.components).flatMap(x => x.events),
            //interfaces
            ...Object.values(this.result.interfaces).flatMap(x => x.implementers),
            //events
            ...Object.values(this.result.events).flatMap(x => x.implementers),
            //nodes
            ...Object.values(this.result.nodes).map(x => x.extends),
            ...Object.values(this.result.nodes).flatMap(x => x.interfaces)
        ];
        for (const ref of refs) {
            if (!ref) {
                continue;
            }
            //set any missing urls
            if (!ref.url) {
                ref.url = this.result.components[ref.name?.toLowerCase()]?.url;
            }
            //convert doc path to url
            if (ref?.url?.startsWith('/docs')) {
                ref.url = getDocUrl(ref.url);
            }
        }

        console.log('Repairing doc paths in descriptions');
        //repair relative links in all description properties
        const items = [
            ...Object.values(this.result.components),
            ...Object.values(this.result.interfaces),
            ...Object.values(this.result.events),
            ...Object.values(this.result.nodes)
        ] as any[];
        while (items.length > 0) {
            const item = items.pop();
            if (item && typeof item === 'object') {
                items.push(
                    ...Object.values(item)
                );
            }
            if (item?.description) {
                item.description = repairMarkdownLinks(item.description);
            }
        }
    }

    /**
     * Link events back to the components that implement them
     */
    public linkMissingImplementers() {
        const events = Object.values(this.result.events);
        for (const name in this.result.components) {
            const component = this.result.components[name];
            for (const ref of component?.events ?? []) {
                //find the event
                const evt = events.find(x => x.name.toLowerCase() === ref?.name?.toLowerCase());
                if (evt) {
                    evt.implementers.push({
                        name: component.name,
                        url: component.url,
                        //we don't have any description available
                        description: undefined
                    });
                }
            }
        }
    }

    /**
     * Sorts internal arrays of the data in results, eg. implementers, properties, methods, etc.
     */
    public sortInternalData() {
        const nameComparer = (a: { name: string }, b: { name: string }) => (a.name.localeCompare(b.name));
        for (let component of Object.values(this.result.components)) {
            component.constructors.sort((a, b) => b.params.length - a.params.length);
            component.events.sort(nameComparer);
            component.interfaces.sort(nameComparer);
        }

        for (let evt of Object.values(this.result.events)) {
            evt.implementers.sort(nameComparer);
            evt.properties.sort(nameComparer);
            evt.methods.sort(nameComparer);
        }

        for (let iface of Object.values(this.result.interfaces)) {
            iface.implementers.sort(nameComparer);
            iface.properties.sort(nameComparer);
            iface.methods.sort(nameComparer);
        }

        for (let node of Object.values(this.result.nodes)) {
            node.events.sort(nameComparer);
            node.fields.sort(nameComparer);
            node.interfaces.sort(nameComparer);
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
            const docApiUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docApiUrl);

            const component = {
                name: manager.getHeading(1)?.text,
                url: getDocUrl(docPath),
                interfaces: manager.getListReferences('supported interfaces'),
                events: manager.getListReferences('supported events'),
                constructors: [],
                description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
            } as BrightScriptComponent;

            manager.setDeprecatedData(component, manager.getHeading(1), manager.getHeading(2));

            if (/this object is created with no parameters/.exec(manager.html)) {
                component.constructors.push({
                    params: [],
                    returnType: component.name,
                    returnDescription: undefined
                });
            } else {

                //find all createObject calls
                const regexp = /CreateObject\((.*?)\)/g;
                let match;
                while (match = regexp.exec(manager.markdown)) {

                    const { statements, diagnostics } = Parser.parse(match[0]);
                    if (diagnostics.length === 0) {
                        const signature = {
                            params: [],
                            returnType: component.name
                        } as Signature;
                        const call = (statements[0] as ExpressionStatement).expression as CallExpression;
                        //only scan createObject calls for our own name
                        if ((call.args[0] as LiteralExpression)?.tokens?.value.text === `"${component.name}"`) {
                            //skip the first arg because that's the name of the component
                            for (let i = 1; i < call.args.length; i++) {
                                const arg = call.args[i];
                                let paramName = `param${i}`;
                                if (isVariableExpression(arg)) {
                                    paramName = arg.getName(ParseMode.BrightScript);
                                }
                                signature.params.push({
                                    name: paramName,
                                    default: undefined,
                                    isRequired: true,
                                    type: (arg as any).type?.toString() ?? 'dynamic',
                                    description: undefined
                                });
                            }
                            component.constructors.push(signature);
                        }
                    } else if (match[1]) {
                        const signature = this.getConstructorSignature(name, match[1]);

                        if (signature) {
                            component.constructors.push(signature);
                        }
                    }
                }
            }
            this.reduceSignatures(component.constructors);

            //if there is a custom handler for this doc, call it
            if (this[name]) {
                console.log(`calling custom handler for ${name}`);
                this[name](component, manager);
            }

            this.result.components[component?.name?.toLowerCase()] = component;
        }
    }

    private getConstructorSignature(componentName: string, sourceCode: string) {
        const foundParamTexts = this.findParamTexts(sourceCode);

        if (foundParamTexts && foundParamTexts[0].toLowerCase() === componentName.toLowerCase()) {
            const signature = {
                params: [],
                returnType: componentName
            } as Signature;

            for (let i = 1; i < foundParamTexts.length; i++) {
                const foundParam = foundParamTexts[i];
                signature.params.push(this.getParamFromMarkdown(foundParam, `param${i}`));
            }
            return signature;
        }
    }


    private findParamTexts(sourceCode: string): string[] {
        if (!sourceCode.includes('{') && !sourceCode.includes('}')) {
            return sourceCode.split(',').map(x => x.replace(/['"]+/g, '').trim());
        }
    }


    /* Gets a param based on text in the docs
     * Docs for some components do not have valid brightscript in the createObject example:
     *  - it looks like C code
     *   Eg: CreateObject("roRegion', Object bitmap, Integer x, Integer y,Integer width, Integer height)
     *  - or, they forget the "as"
     *   Eg: CreateObject("roArray',  size As Integer, resizeAs Boolean)
     * */
    private getParamFromMarkdown(foundParam: string, defaultParamName: string) {
        // make an array of at the words in each group, removing "as" if it exists
        const words = foundParam.split(' ').filter(word => word.length > 0 && word.toLowerCase() !== 'as');
        // find the index of the word that looks like a type
        const paramTypeIndex = words.findIndex(word => potentialTypes.includes(this.sanitizeMarkdownSymbol(word.toLowerCase())));
        let paramType = 'dynamic';
        let paramName = defaultParamName;

        const isOptional = foundParam.endsWith(']') || foundParam.includes('=');

        if (paramTypeIndex >= 0) {
            // if we found a word that looks like a type, use it for the type, and remove it from the array
            paramType = this.sanitizeMarkdownSymbol(words[paramTypeIndex]);

            // translate to an actual BRS type if needed
            paramType = foundTypesTranslation[paramType.toLowerCase()] || paramType;

            words.splice(paramTypeIndex, 1);
            // use the first "left over" word as the param name
            paramName = words[0];
        } else if (words.length > 0) {
            // if we couldn't find a type
            paramName = words[0];
        }

        return {
            name: this.sanitizeMarkdownSymbol(paramName),
            default: null,
            isRequired: !isOptional,
            type: chooseMoreSpecificType(paramType ?? 'dynamic'),
            description: undefined
        } as Param;
    }

    private async buildInterfaces() {
        const interfaceDocs = this.references.BrightScript.Interfaces;
        const count = Object.values(interfaceDocs).length;
        let i = 1;
        for (const name in interfaceDocs) {
            console.log(`Processing interface ${i++} of ${count}`);
            const docPath = interfaceDocs[name];
            const docApiUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docApiUrl);

            try {

                const iface = {
                    name: name,
                    url: getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(manager),
                    properties: [],
                    implementers: this.getImplementers(manager),
                    description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                    availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
                } as RokuInterface;

                manager.setDeprecatedData(iface, manager.getHeading(1), manager.getHeading(2));

                //if there is a custom handler for this doc, call it
                if (this[name]) {
                    console.log(`calling custom handler for ${name}`);
                    this[name](iface, document);
                }

                this.result.interfaces[name?.toLowerCase()] = iface as any;
            } catch (e) {
                console.error(`Error processing interface ${docApiUrl}`, e);
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
            const docApiUrl = this.getDocApiUrl(docPath);
            const manager = await new TokenManager().process(docApiUrl);

            try {
                const evt = {
                    name: name,
                    url: getDocUrl(docPath),
                    methods: this.buildInterfaceMethods(manager),
                    properties: [],
                    implementers: this.getImplementers(manager),
                    description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                    availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading')
                } as RokuEvent;

                manager.setDeprecatedData(evt, manager.getHeading(1), manager.getHeading(2));

                //if there is a custom handler for this doc, call it
                if (this[name]) {
                    console.log(`calling custom handler for ${name}`);
                    this[name](evt, document);
                }

                this.result.events[name?.toLowerCase()] = evt as any;
            } catch (e) {
                console.error(`Error processing interface ${docApiUrl}`, e);
            }
        }
    }

    private flatten(object, parentKey?: string) {
        const result = [] as Array<{ name: string; path: string; categoryName: string }>;
        for (const key in object) {
            const value = object[key];
            if (typeof value === 'string') {
                result.push({
                    name: key,
                    path: value,
                    categoryName: parentKey
                });
            } else if (typeof value === 'object') {
                result.push(
                    ...this.flatten(value, key)
                );
            }
        }
        return result;
    }

    private async buildNodes() {
        const docs = this.flatten(this.references.SceneGraph);

        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            //skip non-component pages
            if (/(component\s*functions)|(xml\s*elements)/i.exec(doc?.categoryName) || doc?.name?.toLowerCase() === 'overview') {
                continue;
            }
            console.log(`Processing node ${i} of ${docs.length}`);

            const docApiUrl = this.getDocApiUrl(doc.path);
            const manager = await new TokenManager().process(docApiUrl);

            try {

                const node = {
                    name: manager.getHeading(1).text,
                    url: getDocUrl(doc.path),
                    extends: manager.getExtendsRef(),
                    description: manager.getMarkdown(manager.getHeading(1), x => x.type === 'heading'),
                    availableSince: manager.getAvailableSince(manager.getHeading(1), x => x.type === 'heading'),
                    fields: this.getNodeFields(manager),
                    events: [],
                    interfaces: []
                } as SceneGraphNode;

                //hydrate the `Node` node with roSGNode component info
                if (node.name === 'Node') {
                    const roSGNode = this.result.components['rosgnode'];
                    node.events = roSGNode.events ?? [];
                    node.interfaces = roSGNode.interfaces ?? [];
                }

                //if there is a custom handler for this doc, call it
                if (this[node.name]) {
                    console.log(`calling custom handler for ${name}`);
                    this[node.name](node, document);
                }

                this.result.nodes[node.name?.toLowerCase()] = node as any;
            } catch (e) {
                console.error(`Error processing interface ${docApiUrl}`, e);
            }
        }
    }

    private getNodeFields(manager: TokenManager) {
        const result = [] as SceneGraphNodeField[];
        const table = manager.getTableByHeaders(['field', 'type', 'default', 'access permission', 'description']);
        const rows = manager.tableToObjects(table);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let description = table.rows[i][4].text;
            //the turndown plugin doesn't convert inner html tables, so turn that into markdown too
            description = turndownService.turndown(description);
            result.push({
                name: this.sanitizeMarkdownSymbol(row.field),
                type: this.sanitizeMarkdownSymbol(row.type),
                default: this.sanitizeMarkdownSymbol(row.default, true),
                accessPermission: this.sanitizeMarkdownSymbol(row['access permission']),
                //grab all the markdown from the 4th column (description)
                description: description
            });
        }

        return result;
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
            for (const row of table?.rows ?? []) {
                const firstTokenInRow = row?.[0]?.tokens[0];
                //find the link, or default to the cell itself (assume it's a text node?)
                const token = deepSearch(firstTokenInRow, 'type', (key, value) => value === 'link') ?? firstTokenInRow;
                result.push({
                    name: token.text,
                    description: he.decode(row?.[1].text ?? '') || undefined,
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
    private roAppManager(component: BrightScriptComponent, manager: TokenManager) {
        const iface = {
            name: 'AppManagerTheme',
            properties: [],
            implementers: [],
            methods: [],
            url: undefined
        } as RokuInterface;
        const table = manager.getTableByHeaders(
            ['attribute', 'screen types', 'values', 'example', 'version']
        );
        for (const row of manager.tableToObjects(table)) {
            iface.properties.push({
                name: this.sanitizeMarkdownSymbol(row.attribute),
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
            const headerNames = [...x.getElementsByTagName('tr')?.[0].getElementsByTagName('th') ?? []].map(x => x.innerHTML.toLowerCase());

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

    private buildInterfaceMethods(manager: TokenManager) {
        const result = [] as Func[];
        //find every h3
        const methodHeaders = manager.getByType<marked.Tokens.Heading>('heading').filter(x => x.depth === 3);
        for (let i = 0; i < methodHeaders.length; i++) {
            const methodHeader = methodHeaders[i];
            const nextMethodHeader = methodHeaders[i + 1];
            const method = this.getMethod(methodHeader.text);
            if (method) {
                manager.setDeprecatedData(method, methodHeader, nextMethodHeader);

                method.description = (
                    manager.find(x => {
                        if (x === methodHeader || /^\**description/i.exec(x?.text) || /^_?available\s*since/i.exec(x?.text)) {
                            return false;
                        }
                        return x.type === 'paragraph';
                    }, methodHeader, nextMethodHeader) as marked.Tokens.Paragraph)?.text;

                if (!method.description) {
                    method.description = manager.getNextToken<marked.Tokens.Paragraph>(methodHeader)?.text;
                }

                method.returnDescription = manager.getNextToken<marked.Tokens.Paragraph>(
                    manager.find(x => !!/return\s*value/i.exec(x?.text), methodHeader, nextMethodHeader)
                )?.text;

                //augment parameter info from optional parameters table
                const parameterObjects = manager.tableToObjects(
                    manager.getTableByHeaders(['name', 'type', 'description'], methodHeader, x => x === nextMethodHeader)
                );
                for (const row of parameterObjects ?? []) {
                    // Some docs have invalid param names
                    const rowNameSanitized = this.sanitizeMarkdownSymbol(row.name).toLowerCase();

                    const methodParam = method.params.find(p => p?.name && p.name?.toLowerCase() === rowNameSanitized);
                    if (methodParam) {
                        methodParam.type = chooseMoreSpecificType(methodParam.type, row.type);
                        methodParam.description = convertHTMLTable(row.description ?? methodParam.description);
                    }
                }

                result.push(method);
            }
        }
        return result;
    }

    private sanitizeMarkdownSymbol(symbolName: string, allowSquareBrackets = false) {
        if (allowSquareBrackets) {
            return symbolName?.replaceAll(/[\\]/g, '');
        }
        return symbolName?.replaceAll(/[\[\]\\]/g, '');
    }


    private fixFunctionParams(text: string): string {
        return text.replace(/to as /ig, 'toValue as ');
    }

    private getMethod(text: string) {
        // var state = new TranspileState(new BrsFile({ srcPath: '', destPath: '', program: new Program({})});
        let functionSignatureToParse = `function ${this.fixFunctionParams(this.sanitizeMarkdownSymbol(text))}\nend function`;
        const variadicRegex = new RegExp(/,?\s*\.\.\.\s*\)/, 'g'); // looks for  " ...)"
        const variadicMatch = functionSignatureToParse.match(variadicRegex);
        if (variadicMatch) {
            functionSignatureToParse = functionSignatureToParse.replace(variadicRegex, ')');
        }

        const { statements } = Parser.parse(functionSignatureToParse);
        if (statements.length > 0) {
            const func = statements[0] as FunctionStatement;
            const signature = {
                name: func.tokens.name?.text,
                params: [],
                returnType: func.func.returnTypeExpression?.getType({ flags: SymbolTypeFlag.typetime })?.toTypeString() ?? 'Void'
            } as Func;

            if (variadicMatch) {
                signature.isVariadic = true;
            }


            const paramsRegex = /\((.*?)\)/g;
            let match = paramsRegex.exec(text);
            if (match[1]) {
                const foundParamTexts = match[1].split(',').map(x => x.replace(/['"]+/g, '').trim());
                for (let i = 0; i < foundParamTexts.length; i++) {
                    const foundParam = foundParamTexts[i];
                    if (foundParam === '...') {
                        break;
                    }
                    signature.params.push(this.getParamFromMarkdown(foundParam, `param${i}`));
                }
            }
            return signature;
        } else {
            console.error('Could not parse method', functionSignatureToParse);
        }

    }

    private getDocApiUrl(docRelativePath: string) {
        return `https://developer.roku.com/api/v1/get-dev-cms-doc?locale=en-us&filePath=${docRelativePath.replace(/^\/docs\//, '')}`;
    }

    private async loadReferences() {
        const response = await getJson('https://developer.roku.com/api/v1/get-dev-cms-doc?filePath=left-nav%2Freferences.json&locale=en-us');
        this.references = JSON.parse(response.content);
    }

    /**
     * Merge hand-written overrides to the Roku docs. This is for missing items or fixing incorrect info
     */
    private mergeOverrides() {
        this.result = deepmerge(this.result, {
            nodes: {
                rsgpalette: {
                    availableSince: '9.4',
                    description: 'Extends [Node](https://developer.roku.com/docs/references/scenegraph/node.md\n\nThe **RSGPalette** node allows developers to specify a named set of color values that can be shared among nodes that support RSGPalette colors.\n\nNodes that support RSGPalette colors include a **palette** field, which can be set to an **RSGPalette** node to override the default colors used by the node. The specific palette values used by those nodes are defined in each node\'s documentation.\n\nIf a node that supports a palette does not set its **palette** filed, the RSGPalette is inherited from ancestor nodes in the scene graph. Specifically, the node looks up the scene graph until it finds a **PaletteGroup** node with its **palette** field set. This may be found in the **Scene** itself.\n\nIf no node in the scene graph has its **palette** field set, the keyboard uses the default palette (gray background/white text).\n\nCurrently, the **RSGPalette** node is typically used in channels that customize the colors of the dynamic keyboard nodes. In this case, the channel assigns the RSGPalette node to the **palette** field of the [DynamicKeyboardBase](https://developer.roku.com/docs/references/scenegraph/dynamic-voice-keyboard-nodes/dynamic-keyboard-base.md\"DynamicKeyboardBase\") node and lets the keyboard\'s **DynamicKeyGrid** and **VoiceTextEditBox** inherit that RSGPalette.\n\n> The colors in the RSGPalette do not cascade. If a child node overrides its parent\'s RSGPalette node, that RSGPalette should specify values for all the colors used by the node. Unspecified values will use the system default colors.',
                    events: [],
                    extends: {
                        name: 'Node',
                        url: 'https://developer.roku.com/docs/references/scenegraph/node.md'
                    },
                    fields: [
                        {
                            accessPermission: 'READ_WRITE',
                            default: 'not specified',
                            description: 'Specifies an associative array of color name/color key-value pairs. For example: \\`\\`\\` { PrimaryTextColor: 0x111111FF, FocusColor: 0x0000FFFF } \\`\\`\\` .',
                            name: 'colors',
                            type: 'associative array'
                        }
                    ],
                    interfaces: [],
                    name: 'RSGPalette',
                    url: 'https://developer.roku.com/en-ca/docs/references/scenegraph/scene.md'
                }
            },
            components: {
                roregion: {
                    interfaces: [{
                        name: 'ifDraw2D',
                        url: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdraw2d.md'
                    }]
                }
            },
            events: {},
            interfaces: {}
        });

        // Override ifSGNodeDict.callFunc
        /*fixMethod(this.result.interfaces.ifsgnodedict, 'callfunc', {
            // Taken from: https://developer.roku.com/en-ca/docs/references/brightscript/interfaces/ifsgnodedict.md#callfunc
            description: `callFunc() is a synchronized interface on roSGNode. It will always execute in the component's owning ScriptEngine and thread (by rendezvous if necessary), and it will always use the m and m.top of the owning component. Any context from the caller can be passed via one or more method parameters, which may be of any type (previously, callFunc() only supported a single associative array parameter).\n\nTo call the function, use the \`callFunc\` field with the required method signature. A return value, if any, can be an object that is similarly arbitrary. The method being called must determine how to interpret the parameters included in the \`callFunc\` field.`,
            name: 'callFunc',
            params: [
                {
                    default: null,
                    description: 'The function name to call.',
                    isRequired: true,
                    name: 'functionName',
                    type: 'String'
                }
            ],
            isVariadic: true,
            returnType: 'Dynamic',
            returnDescription: 'An arbitrary object'
        });*/

        // fix ifStringOp overloads
        fixOverloadedMethod(this.result.interfaces.ifstringops, 'instr');
        fixOverloadedMethod(this.result.interfaces.ifstringops, 'mid');
        fixOverloadedMethod(this.result.interfaces.ifstringops, 'startsWith');
        fixOverloadedMethod(this.result.interfaces.ifstringops, 'endswith');

        // fix ifSGNodeField overloads
        fixOverloadedMethod(this.result.interfaces.ifsgnodefield, 'observeField');
        fixOverloadedMethod(this.result.interfaces.ifsgnodefield, 'observeFieldScoped');

        // fix ifdraw2d overloads
        fixOverloadedMethod(this.result.interfaces.ifdraw2d, 'drawScaledObject');
    }
}

function fixOverloadedMethod(iface: RokuInterface, funcName: string) {
    const originalOverloads = iface.methods.filter(method => method.name.toLowerCase() === funcName.toLowerCase());
    if (originalOverloads.length === 0) {
        console.error('Could not fix overloaded method - no methods', funcName);
        return;
    } else if (originalOverloads.length === 1) {
        console.log('No need to fix overloaded method - just one method', funcName);
        return;
    }

    const descriptions: string[] = [];
    const returnDescriptions: string[] = [];
    const returnTypes: string[] = [];
    for (const originalOverload of originalOverloads) {
        if (!descriptions.includes(originalOverload.description)) {
            descriptions.push(originalOverload.description);
        }
        if (!returnDescriptions.includes(originalOverload.returnDescription)) {
            returnDescriptions.push(originalOverload.returnDescription);
        }
        if (!returnTypes.includes(originalOverload.returnType)) {
            returnTypes.push(originalOverload.returnType);
        }
    }
    const mergedFunc: Func = {
        name: originalOverloads[0].name,
        params: [],
        description: `**OVERLOADED METHOD**\n\n` + descriptions.join('\n\n or \n\n'),
        returnType: returnTypes.length > 0 ? returnTypes.join(' or ') : '',
        returnDescription: returnDescriptions.length > 0 ? returnDescriptions.join('\n\n or \n\n') : ''
    };

    const maxParamsInAnyOverload = Math.max(...originalOverloads.map(x => x.params.length));
    for (let i = 0; i < maxParamsInAnyOverload; i++) {
        const paramNames: string[] = [];
        let paramIsRequired = true;
        const paramDescriptions: string[] = [];
        const paramDefaults: string[] = [];
        const paramTypes: string[] = [];

        for (const originalMethod of originalOverloads) {
            let p = originalMethod.params[i];
            if (p) {
                if (!paramNames.includes(p.name)) {
                    paramNames.push(p.name);
                }
                if (!paramDescriptions.includes(p.description)) {
                    paramDescriptions.push(p.description);
                }
                if (p.default && !paramDefaults.includes(p.default)) {
                    paramDefaults.push(p.default);
                }
                const pTypes = Array.isArray(p.type) ? p.type : [p.type];
                for (const pType of pTypes) {
                    if (!paramTypes.includes(pType)) {
                        paramTypes.push(pType);
                    }
                }
                paramIsRequired = paramIsRequired && p.isRequired;
            } else {
                paramIsRequired = false;
            }
        }
        // camelCase param names
        let mergedParamName = paramNames.map((name, index) => {
            return index === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
        }).join('Or');

        mergedFunc.params.push({
            name: mergedParamName,
            description: paramDescriptions.join(' OR '),
            default: paramDefaults.length > 0 ? paramDefaults.join(' or ') : null,
            isRequired: paramIsRequired,
            type: paramTypes.join(' or ')
        });
    }
    // remove existing
    iface.methods = iface.methods.filter(method => method.name.toLowerCase() !== funcName.toLowerCase());
    // add to list
    iface.methods.push(mergedFunc);
}


function fixMethod(iface: RokuInterface, funcName: string, mergeData: Func) {
    const index = iface?.methods.findIndex(method => method.name.toLowerCase() === funcName.toLowerCase());
    if (index >= 0) {
        iface.methods[index] = deepmerge(iface.methods[index], mergeData);
    } else {
        console.error('Could not fix method', funcName);
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
        cache[url] = (await phin({
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
            }
        })).body.toString();
        saveCache();
    } else {
        console.log('Fetching from cache', url);
    }
    return JSON.parse(cache[url]);
}

function getDocUrl(docRelativePath: string) {
    if (docRelativePath) {
        return `https://developer.roku.com${docRelativePath}`;
    }
}

function deepSearch<T = any>(object, key, predicate): T {
    if (object.hasOwnProperty(key) && predicate(key, object[key]) === true) {
        return object;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
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

function repairMarkdownLinks(text: string) {
    if (typeof text !== 'string') {
        return text;
    }
    const regexp = /\((\/docs\/references\/.*?.md)/g;
    let match: RegExpExecArray;
    const matches = [] as RegExpExecArray[];
    while (match = regexp.exec(text)) {
        matches.push(match);
    }

    //process the matches in reverse to preserve string indexes
    for (const match of matches.reverse()) {
        //+1 to step past the opening paren
        text = text.substring(0, match.index + 1) + getDocUrl(match[1]) + text.substring(match.index + 1 + match[0].length);
    }
    return text;
}

/**
 * Replacer function for JSON.Stringify to sort keys in objects
 * Note - this ignores the top level properties
 * from: https://gist.github.com/davidfurlong/463a83a33b70a3b6618e97ec9679e490
 */
function objectKeySorter(key, value) {
    return (value instanceof Object && !(value instanceof Array)) && !!key
        ? Object.keys(value)
            .sort()
            .reduce((sorted, key) => {
                sorted[key] = value[key];
                return sorted;
            }, {})
        : value;
}

/**
 * For two types (or arrays of types), chooses the group that's "more specific"
 *
 * @param typeOne  the first type group or string
 * @param typeTwo the first type group or string
 * @returns a type (or group of types) that is more specific
 */
function chooseMoreSpecificType(typeOne: string | string[] = 'dynamic', typeTwo: string | string[] = 'dynamic'): string | string[] {

    // deals with issue where it says "roScreen or roBitmap', etc
    // also when there is a problematic space, eg "roAssoc Array"
    const splitRegex = /,|\sor\s/;
    if (typeof typeOne === 'string') {
        typeOne = typeOne.split(splitRegex);
    }
    if (typeof typeTwo === 'string') {
        typeTwo = typeTwo.split(splitRegex);
    }
    const typeOneArray = typeOne.map(paramType => foundTypesTranslation[paramType.toLowerCase()] || paramType);
    const typeTwoArray = typeTwo.map(paramType => foundTypesTranslation[paramType.toLowerCase()] || paramType);

    function getSingle(strArray: string[]): string | string[] {
        return strArray.length === 1 ? strArray[0] : strArray;
    }

    if (typeTwo.map(a => a.toLowerCase()).includes('dynamic')) {
        // the second group has "dynamic" in it, so prefer the first group
        return getSingle(typeOneArray);
    } else if (typeOne.map(a => a.toLowerCase()).includes('dynamic')) {
        // second group does not have dynamic, but first does, so 2nd group is more specific
        return getSingle(typeTwoArray);
    } else if (typeOneArray.length > typeTwoArray.length) {
        // first group has more types
        return getSingle(typeOneArray);
    } else if (typeTwoArray.length > typeOneArray.length) {
        // 2nd group has more types
        return getSingle(typeTwoArray);
    } else if (typeOneArray.length === 1 && typeTwoArray.length === 1) {
        // both have one type
        if (typeOneArray[0].toLowerCase() === 'object' && typeTwoArray[0].toLowerCase().startsWith('ro')) {
            // the first type is "Object', but is more specific in second type
            return getSingle(typeTwoArray);
        }
        if (typeTwoArray[0].toLowerCase() === 'object') {
            // Second type is Object ... so prefer the 1st, which usually comes from a code line
            return getSingle(typeOneArray);
        }
    }
    return getSingle(typeOneArray);
}


function convertHTMLTable(description: string): string {
    return description.replace(/\<table\>.*\<\/table\>/g, (match) => {
        return '\n' + NodeHtmlMarkdown.translate(match, {}) + '\n';
    });
}

/**
 * A class to help manage the parsed markdown tokens
 */
class TokenManager {
    public html: string;
    public markdown: string;
    public tokens: marked.TokensList;

    public async process(url: string) {
        try {
            this.html = (await getJson(url)).content;
            this.markdown = turndownService.turndown(this.html);
            this.tokens = marked.lexer(this.markdown);
        } catch (e) {
            console.error('Unable to process url: ', url);
        }
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
    public getTableByHeaders(searchHeaders: string[], startAt?: Token, endTokenMatcher?: EndTokenMatcher): TableEnhanced {
        let startIndex = this.tokens.indexOf(startAt);
        startIndex = startIndex > -1 ? startIndex : 0;

        for (let i = startIndex + 1; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            if (token?.type === 'table') {
                const headers = token?.header?.map(x => x.text.toLowerCase());
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
    public tableToObjects(table: marked.Tokens.Table) {
        const result = [] as Record<string, string>[];
        const headers = table?.header?.map(x => x.text.toLowerCase());
        for (const row of table?.rows ?? []) {
            const data = {} as Record<string, string>;
            for (let i = 0; i < headers.length; i++) {
                data[headers[i]] = row[i].text;
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

    /**
     * Find any `is deprecated` text between the specified items
     */
    public getDeprecatedDescription(startToken: Token, endToken: Token) {
        const deprecatedDescription = this.find<marked.Tokens.Text>(x => !!/is\s*deprecated/i.exec(x?.text), startToken, endToken)?.text;
        return deprecatedDescription;
    }

    /**
     * Sets `deprecatedDescription` and `isDeprecated` on passed in entity if `deprecated` is mentioned between the two tokens
     */
    public setDeprecatedData(entity: PossiblyDeprecated, startToken: Token, endToken: Token) {
        entity.deprecatedDescription = this.getDeprecatedDescription(startToken, endToken);
        if (entity.deprecatedDescription) {
            entity.isDeprecated = true;
        }
    }

    /**
     * Search for `Extends [SomeComponentName](some_url)` in the top-level description
     */
    public getExtendsRef() {
        const extendsToken = this.getTokensBetween(
            this.getHeading(1),
            x => x.type === 'heading'
        )?.find(
            x => x.raw?.toLowerCase().startsWith('extends')
        ) as any;
        //assume the second token is the link
        const link = extendsToken?.tokens[1];
        if (link) {
            return {
                name: link?.text?.replace(/^\*\*/, '').replace(/\*\*$/, ''),
                url: getDocUrl(link?.href)
            } as Reference;
        }
    }
}

type EndTokenMatcher = (t: Token) => boolean | undefined;

interface TableEnhanced extends marked.Tokens.Table {
    tokens: {
        header: Array<Array<marked.TokensList>>;
        rows: Array<Array<marked.TokensList>>;
    };
}

interface PossiblyDeprecated {
    isDeprecated?: boolean;
    deprecatedDescription?: string;
}

interface BrightScriptComponent extends PossiblyDeprecated {
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

interface RokuInterface extends PossiblyDeprecated {
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

interface RokuEvent extends PossiblyDeprecated {
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

interface SceneGraphNode {
    name: string;
    url: string;
    /**
     * The parent node this node extends
     */
    extends?: Reference;
    availableSince: string;
    description: string;
    interfaces: Reference[];
    events: Reference[];
    fields: SceneGraphNodeField[];
    methods: Func[];
}

interface SceneGraphNodeField {
    name: string;
    type: string;
    default: string;
    accessPermission: string;
    /**
     * The markdown description of this field
     */
    description: string;
}

interface Func extends Signature, PossiblyDeprecated {
    name: string;
    description: string;
}
interface Param {
    name: string;
    isRequired: boolean;
    description: string;
    default: string;
    type: string | string[];
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
    isVariadic?: boolean;
}
interface ElementFilter {
    id?: string;
    text?: string;
    type?: string;
    class?: string;
}

//run the builder
new Runner().run().catch((e) => console.error(e));

