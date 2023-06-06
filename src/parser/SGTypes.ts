import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { createSGAttribute, createSGInterface, createSGInterfaceField, createSGInterfaceFunction } from '../astUtils/creators';
import type { FileReference } from '../interfaces';
import { BooleanType } from '../types/BooleanType';
import { DynamicType } from '../types/DynamicType';
import { FloatType } from '../types/FloatType';
import { IntegerType } from '../types/IntegerType';
import { LongIntegerType } from '../types/LongIntegerType';
import { StringType } from '../types/StringType';
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
    public set value(val) {
        if (val === null || val === undefined) {
            val = '';
        }
        if (!this.tokens.equals) {
            this.tokens.equals = { text: '=' };
        }
        if (this.tokens.value) {
            this.tokens.value.text = val;
        } else {
            this.tokens.value = { text: val };
        }
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

    public clone() {
        return new SGAttribute(
            { ...this.tokens.key },
            { ...this.tokens.equals },
            { ...this.tokens.openingQuote },
            { ...this.tokens.value },
            { ...this.tokens.closingQuote }
        );
    }
}

export class SGElement {

    constructor(
        startTagOpen: SGToken,
        startTagName: SGToken,
        attributes = [] as SGAttribute[],
        startTagClose?: SGToken,
        elements = [] as SGElement[],
        endTagOpen?: SGToken,
        endTagName?: SGToken,
        endTagClose?: SGToken
    ) {
        this.tokens.startTagOpen = startTagOpen;
        this.tokens.startTagName = startTagName;
        this.attributes = attributes;
        this.tokens.startTagClose = startTagClose;
        this.elements = elements;
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
    public elements = [] as SGElement[];

    public get range() {
        if (!this._range) {
            this._range = util.createBoundingRange(
                this.tokens.startTagOpen,
                this.tokens.startTagName,
                this.attributes?.[this.attributes?.length - 1],
                this.tokens.startTagClose,
                this.elements?.[this.elements?.length - 1],
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
        return this.tokens.startTagClose && this.tokens.startTagClose?.text !== '>';
    }

    get id() {
        return this.getAttributeValue('id');
    }
    set id(value: string) {
        this.setAttributeValue('id', value);
    }

    /**
     * Get the name of this tag.
     */
    public get tagName() {
        return this.tokens.startTagName?.text;
    }

    /**
     * Find all direct children by their tag name (case insensitive).
     * This does not step into children's children.
     *
     */
    public getElementsByTagName<T extends SGElement>(tagName: string) {
        const result = [] as T[];
        const lowerTagName = tagName.toLowerCase();
        for (const el of this.elements) {
            if (el.tokens.startTagName.text.toLowerCase() === lowerTagName) {
                result.push(el as T);
            }
        }
        return result as Readonly<Array<T>>;
    }

    /**
     * Add a child to the end of the children array
     */
    public addChild<T extends SGElement>(tag: T) {
        this.elements.push(tag);
        return tag;
    }

    /**
     * Remove a child from the children array.
     * @returns true if node was found and removed, false if the node wasn't there and thus nothing was done
     */
    public removeChild(tag: SGElement) {
        const idx = this.elements.indexOf(tag);
        if (idx > -1) {
            this.elements.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * Does this node have the specified attribute?
     */
    public hasAttribute(name: string) {
        return !!this.getAttribute(name);
    }

    /**
     * Get an SGAttribute by its name (case INsensitive)
     */
    public getAttribute(name: string): SGAttribute | undefined {
        const nameLower = name.toLowerCase();
        for (const attr of this.attributes) {
            if (attr.tokens.key?.text.toLowerCase() === nameLower) {
                return attr;
            }
        }
    }

    /**
     * Get an attribute value by its name
     */
    public getAttributeValue(name: string): string | undefined {
        return this.getAttribute(name)?.tokens.value?.text;
    }

    /**
     * Set an attribute value by its name. If no attribute exists with this name, it is created
     */
    public setAttributeValue(name: string, value: string) {
        if (value === undefined) {
            this.removeAttribute(name);
        } else {
            let attr = this.getAttribute(name);
            //create an attribute with this name if we don't have one yet
            if (!attr) {
                attr = createSGAttribute(name, value);
                this.attributes.push(
                    attr
                );
            }
            attr.value = value;
        }
    }

    /**
     * Remove an attribute by its name. DO NOT USE this to edit AST (use ASTEditor)
     * @returns true if an attribute was found and removed. False if no attribute was found
     */
    public removeAttribute(name: string) {
        const nameLower = name.toLowerCase();
        for (let i = 0; i < this.attributes.length; i++) {
            if (this.attributes[i].key?.toLowerCase() === nameLower) {
                this.attributes.splice(i, 1);
                return true;
            }
        }
        return false;
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
            for (const child of this.elements) {
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

export class SGProlog extends SGElement { }

export class SGNode extends SGElement { }

export class SGChildren extends SGElement { }

export class SGCustomization extends SGElement { }

export class SGScript extends SGElement {

    public cdata?: SGToken;

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttributeValue('type', value);
    }

    get uri() {
        return this.getAttributeValue('uri');
    }
    set uri(value: string) {
        this.setAttributeValue('uri', value);
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
            const lowerKey = attr.tokens.key?.text.toLowerCase();
            if (lowerKey === 'uri' && bsExtensionRegexp.exec(attr.tokens.value?.text)) {
                const clone = attr.clone();
                clone.tokens.value.text.replace(bsExtensionRegexp, '.brs');
                modifiedAttributes.push(clone);
            } else if (lowerKey === 'type') {
                foundType = true;
                if (attr.tokens.value?.text.toLowerCase().endsWith('brighterscript')) {
                    modifiedAttributes.push(
                        attr.clone()
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

export class SGInterfaceField extends SGElement {

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttributeValue('type', value);
    }

    get alias() {
        return this.getAttributeValue('alias');
    }
    set alias(value: string) {
        this.setAttributeValue('alias', value);
    }

    get value() {
        return this.getAttributeValue('value');
    }
    set value(value: string) {
        this.setAttributeValue('value', value);
    }

    get onChange() {
        return this.getAttributeValue('onChange');
    }
    set onChange(value: string) {
        this.setAttributeValue('onChange', value);
    }

    get alwaysNotify() {
        return this.getAttributeValue('alwaysNotify');
    }
    set alwaysNotify(value: string) {
        this.setAttributeValue('alwaysNotify', value);
    }
}

export enum SGFieldType {
    integer = 'integer',
    int = 'int',
    longinteger = 'longinteger',
    float = 'float',
    string = 'string',
    str = 'str',
    boolean = 'boolean',
    bool = 'bool',
    vector2d = 'vector2d',
    color = 'color',
    time = 'time',
    uri = 'uri',
    node = 'node',
    floatarray = 'floatarray',
    intarray = 'intarray',
    boolarray = 'boolarray',
    stringarray = 'stringarray',
    vector2darray = 'vector2darray',
    colorarray = 'colorarray',
    timearray = 'timearray',
    nodearray = 'nodearray',
    assocarray = 'assocarray',
    array = 'array',
    roarray = 'roarray',
    rect2d = 'rect2d',
    rect2darray = 'rect2darray'
}
export const SGFieldTypes = Object.keys(SGFieldType);

export function getBscTypeFromSGFieldType(sgFieldType: string) {
    switch (sgFieldType) {
        case SGFieldType.integer:
        case SGFieldType.int: {
            return new IntegerType();
        }
        case SGFieldType.longinteger: {
            return new LongIntegerType();
        }
        case SGFieldType.float: {
            return new FloatType();
        }
        case SGFieldType.string:
        case SGFieldType.str: {
            return new StringType();
        }
        case SGFieldType.boolean:
        case SGFieldType.bool: {
            return new BooleanType();
        }
        default: {
            return new DynamicType();
        }
    }
}

export class SGInterfaceFunction extends SGElement {
    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttributeValue('name', value);
    }
}

export type SGInterfaceMember = SGInterfaceField | SGInterfaceFunction;

export class SGInterface extends SGElement {
    public get fields() {
        return this.getElementsByTagName<SGInterfaceField>('field');
    }

    public get functions() {
        return this.getElementsByTagName<SGInterfaceFunction>('function');
    }

    public get members() {
        const result = [] as Array<SGInterfaceMember>;
        for (const node of this.elements) {
            const tagName = node.tagName?.toLowerCase();
            if (tagName === 'field' || tagName === 'function') {
                result.push(node as SGInterfaceMember);
            }
        }
        return result as Readonly<typeof result>;
    }

    /**
     * Check if there's an SGField with the specified name
     */
    public hasField(id: string) {
        for (const node of this.elements) {
            const tagName = node.tagName?.toLowerCase();
            if (tagName === 'field' && (node as SGInterfaceField).id === id) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if there's an SGFunction with the specified name
     */
    public hasFunction(name: string) {
        for (const node of this.elements) {
            const tagName = node.tagName?.toLowerCase();
            if (tagName === 'function' && (node as SGInterfaceFunction).name === name) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find a field by its ID
     */
    public getField(id: string) {
        return this.fields.find(field => field.id === id);
    }

    /**
     * Set the value of a field. Creates a new field if one does not already exist with this ID
     */
    public setField(id: string, type: string, onChange?: string, alwaysNotify?: boolean, alias?: string) {
        let field = this.getField(id);
        if (!field) {
            field = this.addChild(
                createSGInterfaceField(id)
            );
        }
        field.type = type;
        field.onChange = onChange;
        if (alwaysNotify === undefined) {
            field.alwaysNotify = undefined;
        } else {
            field.alwaysNotify = alwaysNotify ? 'true' : 'false';
        }
        field.alias = alias;
        return field;
    }

    /**
     * Remove a field from the interface
     * @returns true if a field was found and removed. Returns false if no field was found with that name
     */
    public removeField(id: string) {
        for (let i = 0; i < this.elements.length; i++) {
            const node = this.elements[i];
            if (node.tagName?.toLowerCase() === 'field' && node.id === id) {
                this.elements.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    /**
     * Get the interface function with the specified name
     */
    public getFunction(name: string) {
        return this.functions.find(func => func.name === name);
    }

    /**
     * Add or replace a function on the interface
     */
    public setFunction(name: string) {
        let func = this.getFunction(name);
        if (!func) {
            func = this.addChild(
                createSGInterfaceFunction(name)
            );
        }
        return func;
    }

    /**
     * Remove a function from the interface
     * @returns true if a function was found and removed. Returns false if no function was found with that name
     */
    public removeFunction(name: string) {
        for (let i = 0; i < this.elements.length; i++) {
            const node = this.elements[i];
            if (node.tagName?.toLowerCase() === 'function' && node.getAttributeValue('name') === name) {
                this.elements.splice(i, 1);
                return true;
            }
        }
        return false;
    }
}

/**
 * The `<component>` element in SceneGraph. Not to be confused about usages of components like `<Rectangle>`, those are considered `SGNode` instances.
 */
export class SGComponent extends SGElement {

    /**
     * Get all the <Field> and <Function> elements across all <Interface> nodes in this component
     */
    public get interfaceMembers() {
        const members = [] as Array<SGInterfaceMember>;
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            members.push(
                ...ifaceNode.members
            );
        }
        return members as Readonly<typeof members>;
    }

    public get scriptElements() {
        return this.getElementsByTagName<SGScript>('script');
    }

    /**
     * Get the <interface> element from this component (if present), or undefined if not.
     * NOTE: Roku supports and merges multiple <interface> elements in a component, but this
     * property points to the FIRST one. If you need to check whether a member exists,
     * look through `this.interfaceMemebers` instead.
     */
    public get interfaceElement(): SGInterface | undefined {
        return this.getElementsByTagName<SGInterface>('interface')[0];
    }

    /**
     * Get the `<children>` element of this component. (not to be confused with the AST `childTags` property).
     * If there are multiope `<children>` elements, this function will return the last `<children>` tag because that's what Roku devices do.
     */
    public get childrenElement() {
        const children = this.getElementsByTagName<SGChildren>('children');
        return children[children.length - 1];
    }

    public get customizationElements() {
        return this.getElementsByTagName<SGCustomization>('customization');
    }

    /**
     * Specifies the name of the component, that allows you to create the component in your application.
     * For example, if the name of the component is `CastMemberInfo`, you could create instances of the component declaratively
     * in a child node element of a component `<children>` element (`<CastMemberInfo/>`), or using BrightScript in a `<script>`
     * element (`createObject("roSGNode","CastMemberInfo")`).
     *
     * The name attribute is case-sensitive. You cannot successfully create or declare a component unless the component name exactly
     *  matches the name attribute, including case. Also be aware that two components with the exact same name in the same application
     * components directory will have undefined and generally undesirable results if you attempt to create a component object with that name in the application.
     */
    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttributeValue('name', value);
    }

    /**
     * Specifies the name of the built-in or extended SceneGraph scene or node class whose functionality is extended by this component.
     *
     * For example, `extends="Group"` specifies that the component has all of the functionality of the Group node class (it can have child nodes, has translation/scale/rotation fields, and so forth).
     *
     * By default, a component extends the Group node class.
     */
    get extends() {
        return this.getAttributeValue('extends');
    }
    set extends(value: string) {
        this.setAttributeValue('extends', value);
    }

    /**
     * Specifies the ID of a node declared in the XML file to have the initial remote control focus when the component is instantiated.
     */
    get initialFocus() {
        return this.getAttributeValue('initialFocus');
    }
    set initialFocus(value: string) {
        this.setAttributeValue('initialFocus', value);
    }

    /**
     * Specifies the version of the SceneGraph API. The default is 1.0 if not specified.
     */
    get version() {
        return this.getAttributeValue('version');
    }
    set version(value: string) {
        this.setAttributeValue('version', value);
    }

    /**
     * Does the specified field exist in the component interface?
     */
    public hasInterfaceField(id: string) {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            if (ifaceNode.hasField(id)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Does the specified function exist in the component interface?
     */
    public hasInterfaceFunction(name: string) {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            if (ifaceNode.hasFunction(name)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get an interface field with the specified name
     */
    public getInterfaceField(name: string): SGInterfaceField | undefined {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            const field = ifaceNode.getField(name);
            if (field) {
                return field;
            }
        }
    }

    /**
     * Return the first SGInterface node found, or insert a new one then return it
     */
    private ensureInterfaceNode(): SGInterface {
        for (const el of this.elements) {
            if (el.tokens.startTagName.text.toLowerCase() === 'interface') {
                return el as SGInterface;
            }
        }
        return this.addChild(
            createSGInterface()
        );
    }

    /**
     * Create or update a <field> interface element.
     * This will create a new `<interface>` element if there are none on the component already
     */
    public setInterfaceField(id: string, type: string, onChange?: string, alwaysNotify?: boolean, alias?: string) {
        let ifaceNode = this.ensureInterfaceNode();
        return ifaceNode.setField(id, type, onChange, alwaysNotify, alias);
    }

    /**
     * Create or update a <function> interface element.
     * This will create a new `<interface>` element if there are none on the component already
     */
    public setInterfaceFunction(name: string) {
        let ifaceNode = this.ensureInterfaceNode();
        return ifaceNode.setFunction(name);
    }

    /**
     * Remove an interface field.
     * @returns true if a field was found and removed. Returns false if no field was found with that name
     */
    public removeInterfaceField(id: string) {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            if (ifaceNode.removeField(id)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get an interface field with the specified name
     */
    public getInterfaceFunction(name: string): SGInterfaceFunction | undefined {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            const func = ifaceNode.getFunction(name);
            if (func) {
                return func;
            }
        }
    }

    /**
     * Remove an interface function.
     * @returns true if a function was found and removed. Returns false if no function was found with that name
     */
    public removeInterfaceFunction(name: string) {
        for (const ifaceNode of this.getElementsByTagName<SGInterface>('interface')) {
            if (ifaceNode.removeFunction(name)) {
                return true;
            }
        }
        return false;
    }
}

export interface SGReferences {
    name?: SGToken;
    extends?: SGToken;
    scriptTagImports: Pick<FileReference, 'pkgPath' | 'text' | 'filePathRange'>[];
}

export class SGAst {

    constructor(
        public prologElement?: SGProlog,
        public rootElement?: SGElement,
        public componentElement?: SGComponent
    ) {
    }

    public transpile(state: TranspileState): SourceNode {
        const chunks = [] as SourceNode[];
        //write XML prolog
        if (this.prologElement) {
            chunks.push(
                this.prologElement.transpile(state)
            );
        }
        if (this.componentElement) {
            //write content
            chunks.push(
                this.componentElement.transpile(state)
            );
        }
        return new SourceNode(null, null, null, chunks);
    }
}
