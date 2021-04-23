import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { createSGAttribute, createSGInterfaceField, createSGInterfaceFunction } from '../astUtils/creators';
import type { FileReference } from '../interfaces';
import util from '../util';
import type { TranspileState } from './TranspileState';

export interface SGToken {
    text: string;
    range?: Range;
}

export class SGAttribute {
    public constructor(
        key: SGToken,
        equals?: SGToken,
        openingQuote?: SGToken,
        value?: SGToken,
        closingQuote?: SGToken
    ) {
        this.tokens.key = key;
        this.tokens.equals = equals;
        this.tokens.openingQuote = openingQuote;
        this.tokens.value = value;
        this.tokens.closingQuote = closingQuote;
    }

    public tokens = {} as {
        key: SGToken;
        equals?: SGToken;
        openingQuote?: SGToken;
        value?: SGToken;
        closingQuote?: SGToken;
    };

    public get key() {
        return this.tokens.key.text;
    }

    /**
     * The value of this attribute. This does not including the opening or closing quote
     */
    public get value(): string | undefined {
        return this.tokens.value?.text;
    }

    public get range() {
        if (!this._range) {
            this._range = util.createBoundingRange(
                this.tokens.key,
                this.tokens.equals,
                this.tokens.openingQuote,
                this.tokens.value,
                this.tokens.closingQuote
            );
        }
        return this._range;
    }
    private _range = null as Range;

    public transpile(state: TranspileState) {
        const result = [
            state.transpileToken(this.tokens.key)
        ];
        if (this.tokens.value) {
            result.push(
                state.transpileToken(this.tokens.equals, '='),
                state.transpileToken(this.tokens.openingQuote, '"'),
                state.transpileToken(this.tokens.value),
                state.transpileToken(this.tokens.closingQuote, '"')
            );
        }
        return new SourceNode(null, null, null, result);
    }
}

export class SGTag {

    constructor(
        startTagOpen: SGToken,
        startTagName: SGToken,
        attributes = [] as SGAttribute[],
        startTagClose?: SGToken,
        children = [] as SGTag[],
        endTagOpen?: SGToken,
        endTagName?: SGToken,
        endTagClose?: SGToken
    ) {
        this.tokens.startTagOpen = startTagOpen;
        this.tokens.startTagName = startTagName;
        this.attributes = attributes;
        this.tokens.startTagClose = startTagClose;
        this.children = children;
        this.tokens.endTagOpen = endTagOpen;
        this.tokens.endTagName = endTagName;
        this.tokens.endTagClose = endTagClose;
    }

    public tokens = {} as {
        /**
        * The first portion of the startTag. (i.e. `<` or `<?`)
        */
        startTagOpen: SGToken;
        /**
         * The name of the opening tag (i.e. CoolTag in `<CoolTag>`).
         */
        startTagName: SGToken;
        /**
         * The last bit of the startTag (i.e. `/>` for self-closing, `?>` for xml prologue, or `>` for tag with children)
         */
        startTagClose?: SGToken;
        /**
         * The endTag opening char `<`
         */
        endTagOpen?: SGToken;
        /**
         * The name of the ending tag (i.e. CoolTag in `</CoolTag>`)
         */
        endTagName?: SGToken;
        /**
         * The endTag closing char `>`
         */
        endTagClose?: SGToken;
    };

    /**
     * Array of attributes found on this tag
     */
    public attributes = [] as SGAttribute[];

    /**
     * The array of direct children AST elements of this AST node
     */
    public children = [] as SGTag[];

    public get range() {
        if (!this._range) {
            this._range = util.createBoundingRange(
                this.tokens.startTagOpen,
                this.tokens.startTagName,
                this.attributes?.[this.attributes?.length - 1],
                this.tokens.startTagClose,
                this.children?.[this.children?.length - 1],
                this.tokens.endTagOpen,
                this.tokens.endTagName,
                this.tokens.endTagClose
            );
        }
        return this._range;
    }
    private _range = null as Range;

    /**
     * Is this a self-closing tag?
     */
    get isSelfClosing() {
        return !this.tokens.endTagName;
    }

    get id() {
        return this.getAttributeValue('id');
    }
    set id(value: string) {
        this.setAttribute('id', value);
    }

    /**
     * Find all direct children by their tag name (case insensitive).
     * This does not step into children's children.
     *
     */
    public getChildrenByTagName<T extends SGTag>(tagName: string) {
        const result = [] as T[];
        const lowerTagName = tagName.toLowerCase();
        for (const el of this.children) {
            if (el.tokens.startTagName.text.toLowerCase() === lowerTagName) {
                result.push(el as T);
            }
        }
        return result;
    }

    /**
     * Add a child to the end of the children array
     */
    public addChild<T extends SGTag>(tag: T) {
        this.children.push(tag);
        return tag;
    }

    /**
     * Remove a child from the children array
     */
    public removeChild(tag: SGTag) {
        const idx = this.children.indexOf(tag);
        if (idx > -1) {
            this.children.splice(idx, 1);
        }
    }

    getAttribute(name: string): SGAttribute | undefined {
        return this.attributes.find(att => att.tokens.key.text.toLowerCase() === name);
    }

    getAttributeValue(name: string): string | undefined {
        return this.getAttribute(name)?.tokens.value?.text;
    }

    setAttribute(name: string, value: string) {
        const attr = this.getAttribute(name);
        if (attr) {
            if (value) {
                attr.tokens.value = { text: value };
            } else {
                this.attributes.splice(this.attributes.indexOf(attr), 1);
            }
        } else if (value) {
            this.attributes.push(
                createSGAttribute(name, value)
            );
        }
    }

    public transpile(state: TranspileState) {
        return new SourceNode(null, null, null, [
            state.transpileToken(this.tokens.startTagOpen, '<'), // <
            state.transpileToken(this.tokens.startTagName),
            this.transpileAttributes(state, this.attributes),
            this.transpileBody(state)
        ]);
    }

    protected transpileBody(state: TranspileState) {
        if (this.isSelfClosing) {
            return new SourceNode(null, null, null, [
                ' ',
                state.transpileToken(this.tokens.startTagClose, '/>'),
                state.newline
            ]);
        } else {
            const chunks = [
                state.transpileToken(this.tokens.startTagClose, '>'),
                state.newline
            ];
            state.blockDepth++;
            for (const child of this.children) {
                chunks.push(
                    state.indentText,
                    child.transpile(state)
                );
            }
            state.blockDepth--;
            chunks.push(
                state.indentText,
                state.transpileToken(this.tokens.endTagOpen, '</'),
                state.transpileToken(this.tokens.endTagName ?? this.tokens.startTagName),
                state.transpileToken(this.tokens.endTagClose, '>'),
                state.newline
            );
            return new SourceNode(null, null, null, chunks);
        }
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]) {
        const chunks = [];
        for (const attr of attributes) {
            chunks.push(' ', attr.transpile(state));
        }
        return new SourceNode(null, null, null, chunks);
    }
}

export class SGProlog extends SGTag { }

export class SGNode extends SGTag { }

export class SGChildren extends SGTag { }

export class SGScript extends SGTag {

    public cdata?: SGToken;

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get uri() {
        return this.getAttributeValue('uri');
    }
    set uri(value: string) {
        this.setAttribute('uri', value);
    }

    protected transpileBody(state: TranspileState) {
        if (this.cdata) {
            return new SourceNode(null, null, null, [
                '>',
                state.transpileToken(this.cdata),
                '</',
                this.tokens.startTagName.text,
                '>',
                state.newline
            ]);
        } else {
            return super.transpileBody(state);
        }
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]) {
        const modifiedAttributes = [] as SGAttribute[];
        let foundType = false;
        const bsExtensionRegexp = /\.bs$/i;

        for (const attr of attributes) {
            const lowerKey = attr.tokens.key.text.toLowerCase();
            if (lowerKey === 'uri' && bsExtensionRegexp.exec(attr.tokens.value.text)) {
                modifiedAttributes.push(
                    util.cloneSGAttribute(attr, attr.tokens.value.text.replace(bsExtensionRegexp, '.brs'))
                );
            } else if (lowerKey === 'type') {
                foundType = true;
                if (attr.tokens.value.text.toLowerCase().endsWith('brighterscript')) {
                    modifiedAttributes.push(
                        util.cloneSGAttribute(attr, 'text/brightscript')
                    );
                } else {
                    modifiedAttributes.push(attr);
                }
            } else {
                modifiedAttributes.push(attr);
            }
        }
        if (!foundType) {
            modifiedAttributes.push(
                createSGAttribute('type', 'text/brightscript')
            );
        }
        return super.transpileAttributes(state, modifiedAttributes);
    }
}

export class SGInterfaceField extends SGTag {

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get alias() {
        return this.getAttributeValue('alias');
    }
    set alias(value: string) {
        this.setAttribute('alias', value);
    }

    get value() {
        return this.getAttributeValue('value');
    }
    set value(value: string) {
        this.setAttribute('value', value);
    }

    get onChange() {
        return this.getAttributeValue('onChange');
    }
    set onChange(value: string) {
        this.setAttribute('onChange', value);
    }

    get alwaysNotify() {
        return this.getAttributeValue('alwaysNotify');
    }
    set alwaysNotify(value: string) {
        this.setAttribute('alwaysNotify', value);
    }
}

export const SGFieldTypes = [
    'integer', 'int', 'longinteger', 'float', 'string', 'str', 'boolean', 'bool',
    'vector2d', 'color', 'time', 'uri', 'node', 'floatarray', 'intarray', 'boolarray',
    'stringarray', 'vector2darray', 'colorarray', 'timearray', 'nodearray', 'assocarray',
    'array', 'roarray', 'rect2d', 'rect2darray'
];

export class SGInterfaceFunction extends SGTag {
    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }
}

export class SGInterface extends SGTag {
    public getFields() {
        return this.getChildrenByTagName<SGInterfaceField>('field');
    }
    public getFunctions() {
        return this.getChildrenByTagName<SGInterfaceFunction>('function');
    }

    getField(id: string) {
        return this.getFields().find(field => field.id === id);
    }
    setField(id: string, type: string, onChange?: string, alwaysNotify?: boolean, alias?: string) {
        let field = this.getField(id);
        if (!field) {
            field = createSGInterfaceField(id);
            this.children.push(field);
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
        return this.getFunctions().find(field => field.name === name);
    }
    setFunction(name: string) {
        let func = this.getFunction(name);
        if (!func) {
            func = createSGInterfaceFunction(name);
            this.children.push(func);
        }
    }
}

export class SGComponent extends SGTag {
    /**
     * Get the <interface> element
     */
    public getInterface() {
        return this.getChildrenByTagName<SGInterface>('interface')[0];
    }

    public getScripts() {
        return this.getChildrenByTagName<SGScript>('script');
    }

    /**
     * Finds the `<children>` element of this component. (not to be confused with the AST `children` property)
     */
    public getChildren() {
        return this.getChildrenByTagName<SGChildren>('children')[0];
    }

    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }

    get extends() {
        return this.getAttributeValue('extends');
    }
    set extends(value: string) {
        this.setAttribute('extends', value);
    }
}

export interface SGReferences {
    name?: SGToken;
    extends?: SGToken;
    scriptTagImports: Pick<FileReference, 'pkgPath' | 'text' | 'filePathRange'>[];
}

export class SGAst {

    constructor(
        public prolog?: SGProlog,
        public root?: SGTag,
        public component?: SGComponent
    ) {
    }

    public transpile(state: TranspileState): SourceNode {
        const chunks = [] as SourceNode[];
        //write XML prolog
        if (this.prolog) {
            chunks.push(
                this.prolog.transpile(state)
            );
        }
        if (this.component) {
            //write content
            chunks.push(
                this.component.transpile(state)
            );
        }
        return new SourceNode(null, null, null, chunks);
    }
}
