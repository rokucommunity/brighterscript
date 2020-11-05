import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { isSGChildren, isSGField, isSGFunction, isSGInterface, isSGScript } from '../astUtils/xml';
import type { FileReference } from '../interfaces';
import type { SGTranspileState } from './SGTranspileState';

export interface SGToken {
    text: string;
    range?: Range;
}

export interface SGAttribute {
    key: SGToken;
    value: SGToken;
    range?: Range;
}

export type SGTagKind = 'prolog' | 'component' | 'interface' | 'field' | 'function' | 'script' | 'children' | 'node';

export class SGTag {
    readonly sgkind: SGTagKind;

    get id() {
        return this.getAttribute('id');
    }
    set id(value: string) {
        this.setAttribute('id', value);
    }

    constructor(
        public tag: SGToken,
        public attributes: SGAttribute[] = [],
        public range?: Range
    ) {}

    getSGAttribute(name: string): SGAttribute | undefined {
        return this.attributes.find(att => att.key.text.toLowerCase() === name);
    }

    getAttribute(name: string): string | undefined {
        return this.getSGAttribute(name)?.value.text;
    }

    setAttribute(name: string, value: string) {
        const attr = this.getSGAttribute(name);
        if (attr) {
            if (value) {
                attr.value = { text: value };
                attr.range = undefined;
            } else {
                this.attributes.splice(this.attributes.indexOf(attr));
            }
        } else if (value) {
            this.attributes.push({
                key: { text: name },
                value: { text: value }
            });
        }
    }

    transpile(state: SGTranspileState): SourceNode {
        return new SourceNode(null, null, state.source, [
            state.indent,
            '<',
            state.transpileToken(this.tag),
            ...state.transpileAttributes(this.attributes),
            ...this.transpileBody(state)
        ]);
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        return [' />\n'];
    }
}

export class SGProlog extends SGTag {
    readonly sgkind: SGTagKind = 'prolog';

    transpile(state: SGTranspileState) {
        return new SourceNode(null, null, state.source, [
            '<?xml',
            ...state.transpileAttributes(this.attributes),
            ' ?>\n'
        ]);
    }
}

export class SGNode extends SGTag {
    readonly sgkind: SGTagKind = 'node';

    constructor(
        tag: SGToken,
        attributes?: SGAttribute[],
        public children: SGNode[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        if (this.children.length > 0) {
            const body: (string | SourceNode)[] = ['>\n'];
            state.blockDepth++;
            body.push(...this.children.map(node => node.transpile(state)));
            state.blockDepth--;
            body.push(state.indent, '</', this.tag.text, '>\n');
            return body;
        } else {
            return super.transpileBody(state);
        }
    }
}

export class SGChildren extends SGNode {
    readonly sgkind: SGTagKind = 'children';

    constructor(
        tag: SGToken = { text: 'children' },
        children: SGNode[] = [],
        range?: Range
    ) {
        super(tag, [], children, range);
    }
}

export class SGScript extends SGTag {
    readonly sgkind: SGTagKind = 'script';

    get type() {
        return this.getAttribute('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get uri() {
        return this.getAttribute('uri');
    }
    set uri(value: string) {
        this.setAttribute('uri', value);
    }

    constructor(
        tag: SGToken = { text: 'script' },
        attributes?: SGAttribute[],
        public cdata?: SGToken,
        range?: Range
    ) {
        super(tag, attributes, range);
        if (!attributes) {
            this.type = 'text/brightscript';
        }
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        if (this.cdata) {
            return [
                '>',
                state.transpileToken(this.cdata),
                '</',
                this.tag.text,
                '>\n'
            ];
        } else {
            return super.transpileBody(state);
        }
    }
}

export class SGField extends SGTag {
    readonly sgkind: SGTagKind = 'field';

    get type() {
        return this.getAttribute('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get alias() {
        return this.getAttribute('alias');
    }
    set alias(value: string) {
        this.setAttribute('alias', value);
    }

    get value() {
        return this.getAttribute('value');
    }
    set value(value: string) {
        this.setAttribute('value', value);
    }

    get onChange() {
        return this.getAttribute('onChange');
    }
    set onChange(value: string) {
        this.setAttribute('onChange', value);
    }

    get alwaysNotify() {
        return this.getAttribute('alwaysNotify');
    }
    set alwaysNotify(value: string) {
        this.setAttribute('alwaysNotify', value);
    }

    constructor(
        tag: SGToken = { text: 'field' },
        attributes: SGAttribute[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }
}

export class SGFunction extends SGTag {
    readonly sgkind: SGTagKind = 'function';

    get name() {
        return this.getAttribute('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }

    constructor(
        tag: SGToken = { text: 'function' },
        attributes: SGAttribute[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }
}

export class SGInterface extends SGTag {
    readonly sgkind: SGTagKind = 'interface';
    fields: SGField[] = [];
    functions: SGFunction[] = [];

    getField(id: string) {
        return this.fields.find(field => field.id === id);
    }
    setField(id: string, type: string, onChange?: string, alwaysNotify?: boolean, alias?: string) {
        let field = this.getField(id);
        if (!field) {
            field = new SGField();
            field.id = id;
            this.fields.push(field);
        }
        field.type = type;
        field.onChange = onChange;
        if (alwaysNotify === undefined) {
            field.alwaysNotify = undefined;
        } else {
            field.alwaysNotify = alwaysNotify ? 'true' : 'false';
        }
        field.alias = alias;
    }

    getFunction(name: string) {
        return this.functions.find(field => field.name === name);
    }
    setFunction(name: string) {
        let func = this.getFunction(name);
        if (!func) {
            func = new SGFunction();
            func.name = name;
            this.functions.push(func);
        }
    }

    constructor(
        tag: SGToken = { text: 'interface' },
        content?: SGTag[],
        range?: Range
    ) {
        super(tag, [], range);
        content?.forEach(tag => {
            if (isSGField(tag)) {
                this.fields.push(tag);
            } else if (isSGFunction(tag)) {
                this.functions.push(tag);
            } else {
                throw new Error(`Unexpected tag ${tag.tag.text}`);
            }
        });
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.fields.length > 0) {
            body.push(...this.fields.map(node => node.transpile(state)));
        }
        if (this.functions.length > 0) {
            body.push(...this.functions.map(node => node.transpile(state)));
        }
        state.blockDepth--;
        body.push(state.indent, '</', this.tag.text, '>\n');
        return body;
    }
}

export class SGComponent extends SGTag {
    readonly sgkind: SGTagKind = 'component';
    interface: SGInterface;
    scripts: SGScript[] = [];
    children: SGChildren;

    get name() {
        return this.getAttribute('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }

    get extends() {
        return this.getAttribute('extends');
    }
    set extends(value: string) {
        this.setAttribute('extends', value);
    }

    constructor(
        tag: SGToken = { text: 'component' },
        attributes?: SGAttribute[],
        content?: SGTag[],
        range?: Range
    ) {
        super(tag, attributes, range);
        content?.forEach(tag => {
            if (isSGInterface(tag)) {
                this.interface = tag;
            } else if (isSGScript(tag)) {
                this.scripts.push(tag);
            } else if (isSGChildren(tag)) {
                this.children = tag;
            } else {
                throw new Error(`Unexpected tag ${tag.tag.text}`);
            }
        });
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.interface) {
            body.push(this.interface.transpile(state));
        }
        if (this.scripts.length > 0) {
            body.push(...this.scripts.map(node => node.transpile(state)));
        }
        if (this.children) {
            body.push(this.children.transpile(state));
        }
        state.blockDepth--;
        body.push(state.indent, '</', this.tag.text, '>\n');
        return body;
    }
}

export interface SGReferences {
    name?: string;
    nameRange?: Range;
    extends?: string;
    extendsRange?: Range;
    scriptTagImports: Pick<FileReference, 'pkgPath' | 'text' | 'filePathRange'>[];
}

export interface SGAst {
    prolog?: SGProlog;
    root?: SGTag;
    component?: SGComponent;
}
