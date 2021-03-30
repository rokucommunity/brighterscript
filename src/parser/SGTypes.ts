import type { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { createSGAttribute, createSGInterfaceField, createSGInterfaceFunction } from '../astUtils/creators';
import type { FileReference, TranspileResult } from '../interfaces';
import util from '../util';
import type { TranspileState } from './TranspileState';

export interface SGToken {
    text: string;
    range?: Range;
}

export class SGAttribute {
    public constructor(
        public key: SGToken,
        public equals?: SGToken,
        public openingQuote?: SGToken,
        public value?: SGToken,
        public closingQuote?: SGToken
    ) {
        this.range = util.createBoundingRange(this.key, this.equals, this.openingQuote, this.value, this.closingQuote);
    }
    public range?: Range;

    public transpile(state: TranspileState): TranspileResult {
        const result = [
            state.transpileToken(this.key)
        ];
        if (this.value) {
            result.push(
                state.transpileToken(this.equals, '='),
                state.transpileToken(this.openingQuote, '"'),
                state.transpileToken(this.value),
                state.transpileToken(this.closingQuote, '"')
            );
        }
        return result;
    }
}

export class SGTag {

    constructor(
        /**
         * The first portion of the startTag. (i.e. `<` or `<?`)
         */
        public startTagOpen: SGToken,
        /**
         * The name of the opening tag (i.e. CoolTag in `<CoolTag>`).
         */
        public startTagName: SGToken,
        /**
         * Array of attributes found on this tag
         */
        public attributes = [] as SGAttribute[],
        /**
         * The last bit of the startTag (i.e. `/>` for self-closing, `?>` for xml prologue, or `>` for tag with children)
         */
        public startTagClose?: SGToken,
        /**
         * The array of direct children AST elements of this AST node
         */
        public children = [] as SGTag[],
        /**
         * The endTag opening char `<`
         */
        public endTagOpen?: SGToken,
        /**
         * The name of the ending tag (i.e. CoolTag in `</CoolTag>`)
         */
        public endTagName?: SGToken,
        /**
         * The endTag closing char `>`
         */
        public endTagClose?: SGToken
    ) {
        this.range = util.createBoundingRange(
            this.startTagOpen,
            this.startTagName,
            this.attributes?.[this.attributes?.length - 1],
            this.startTagClose,
            this.children?.[this.children?.length - 1],
            this.endTagOpen,
            this.endTagName,
            this.endTagClose
        );
    }

    public range: Range;

    /**
     * Is this a self-closing tag?
     */
    get isSelfClosing() {
        return !this.endTagName;
    }

    get id() {
        return this.getAttributeValue('id');
    }
    set id(value: string) {
        this.setAttribute('id', value);
    }

    /**
     * Find all direct children by their tag name (case insensitive)
     */
    public getChildrenByTagName<T extends SGTag>(tagName: string) {
        const result = [] as T[];
        const lowerTagName = tagName.toLowerCase();
        for (const el of this.children) {
            if (el.startTagName.text.toLowerCase() === lowerTagName) {
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
        return this.attributes.find(att => att.key.text.toLowerCase() === name);
    }

    getAttributeValue(name: string): string | undefined {
        return this.getAttribute(name)?.value?.text;
    }

    setAttribute(name: string, value: string) {
        const attr = this.getAttribute(name);
        if (attr) {
            if (value) {
                attr.value = { text: value };
                attr.range = undefined;
            } else {
                this.attributes.splice(this.attributes.indexOf(attr), 1);
            }
        } else if (value) {
            this.attributes.push(
                createSGAttribute(name, value)
            );
        }
    }

    public transpile(state: TranspileState): TranspileResult {
        return [
            state.transpileToken(this.startTagOpen, '<'), // <
            state.transpileToken(this.startTagName),
            ...this.transpileAttributes(state, this.attributes),
            ...this.transpileBody(state)
        ];
    }

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        if (this.isSelfClosing) {
            return [
                ' ',
                state.transpileToken(this.startTagClose, '/>'),
                state.newline
            ];
        } else {
            const result = [
                state.transpileToken(this.startTagClose, '>'),
                state.newline
            ];
            state.blockDepth++;
            for (const child of this.children) {
                result.push(
                    state.indentText,
                    ...child.transpile(state)
                );
            }
            state.blockDepth--;
            result.push(
                state.indentText,
                state.transpileToken(this.endTagOpen, '</'),
                state.transpileToken(this.endTagName ?? this.startTagName),
                state.transpileToken(this.endTagClose, '>'),
                state.newline
            );
            return result;
        }
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]): (string | SourceNode)[] {
        const result = [];
        for (const attr of attributes) {
            result.push(' ', attr.transpile(state));
        }
        return result;
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

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        if (this.cdata) {
            return [
                '>',
                state.transpileToken(this.cdata),
                '</',
                this.startTagName.text,
                '>',
                state.newline
            ];
        } else {
            return super.transpileBody(state);
        }
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]): (string | SourceNode)[] {
        const modifiedAttributes = [] as SGAttribute[];
        let foundType = false;
        const bsExtensionRegexp = /\.bs$/i;

        for (const attr of attributes) {
            const lowerKey = attr.key.text.toLowerCase();
            if (lowerKey === 'uri' && bsExtensionRegexp.exec(attr.value.text)) {
                modifiedAttributes.push(
                    util.cloneSGAttribute(attr, attr.value.text.replace(bsExtensionRegexp, '.brs'))
                );
            } else if (lowerKey === 'type') {
                foundType = true;
                if (attr.value.text.toLowerCase().endsWith('brighterscript')) {
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

    public transpile(state: TranspileState): TranspileResult {
        const chunks = [] as TranspileResult;
        //write XML prolog
        if (this.prolog) {
            chunks.push(
                ...this.prolog.transpile(state)
            );
        }
        if (this.component) {
            //write content
            chunks.push(
                ...this.component.transpile(state)
            );
        }
        return chunks;
    }
}
