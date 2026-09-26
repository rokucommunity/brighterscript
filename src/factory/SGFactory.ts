import type { Location } from 'vscode-languageserver';
import type { SGToken } from '../parser/SGTypes';
import { SGAttribute, SGElement, SGProlog, SGNode, SGChildren, SGCustomization, SGScript, SGInterfaceField, SGInterfaceFunction, SGInterface, SGComponent, SGAst } from '../parser/SGTypes';

/**
 * A token for SceneGraph xml nodes. Can be passed as a plain string, which will be converted to an `SGToken` with no location.
 */
export type SGTokenLike = SGToken | string;

/**
 * The options used to create any SceneGraph xml element
 */
export interface SGElementFactoryOptions {
    startTagOpen?: SGTokenLike;
    startTagName?: SGTokenLike;
    /**
     * The attributes for this element. Can be an array of `SGAttribute`, or an object whose keys are the attribute names and values are the attribute values
     */
    attributes?: SGAttribute[] | Record<string, string>;
    startTagClose?: SGTokenLike;
    elements?: SGElement[];
    endTagOpen?: SGTokenLike;
    endTagName?: SGTokenLike;
    endTagClose?: SGTokenLike;
}

/**
 * A factory for creating SceneGraph component nodes (i.e. the contents of a component `.xml` file).
 *
 * Every method is named `create` followed by the class name (i.e. `createSGComponent` creates an `SGComponent`).
 * Most tokens are optional and will be given their default text when omitted, and tokens may be passed as plain strings.
 */
export class SGFactory {
    /**
     * Create a token for a SceneGraph xml node
     */
    public createToken(text: string, location?: Location): SGToken {
        return {
            text: text,
            location: location
        };
    }

    /**
     * Convert a string to an `SGToken`. If an `SGToken` (or undefined) is passed, it is returned unchanged
     */
    private toSGToken(token: SGTokenLike): SGToken {
        return typeof token === 'string' ? this.createToken(token) : token;
    }

    ////////////////////////////////
    // SceneGraph nodes
    ////////////////////////////////

    /**
     * Build the constructor options for an SG element, filling in default tokens.
     * @param options the options passed by the caller
     * @param defaultTagName the tag name to use when `options.startTagName` is not provided
     * @param defaultSelfClosing if true, the element will be self-closing (i.e. `<field />`) when it has no child elements
     */
    private getSGElementOptions(options: SGElementFactoryOptions | undefined, defaultTagName: string | undefined, defaultSelfClosing: boolean) {
        const startTagName = this.toSGToken(options?.startTagName ?? defaultTagName);
        const selfClosing = defaultSelfClosing && !options?.elements?.length;

        let attributes: SGAttribute[];
        if (Array.isArray(options?.attributes)) {
            attributes = options.attributes;
        } else {
            attributes = Object.entries(options?.attributes ?? {}).map(([key, value]) => this.createSGAttribute({ key: key, value: value }));
        }
        return {
            startTagOpen: this.toSGToken(options?.startTagOpen ?? '<'),
            startTagName: startTagName,
            attributes: attributes,
            startTagClose: this.toSGToken(options?.startTagClose ?? (selfClosing ? '/>' : '>')),
            elements: options?.elements ?? [],
            endTagOpen: selfClosing ? undefined : this.toSGToken(options?.endTagOpen ?? '</'),
            endTagName: selfClosing ? undefined : this.toSGToken(options?.endTagName ?? startTagName?.text),
            endTagClose: selfClosing ? undefined : this.toSGToken(options?.endTagClose ?? '>')
        };
    }

    /**
     * Create an `SGAttribute` (i.e. `name="value"`). The `=` and quotes default to their standard text
     */
    public createSGAttribute(options: {
        key: SGTokenLike;
        equals?: SGTokenLike;
        openingQuote?: SGTokenLike;
        value?: SGTokenLike;
        closingQuote?: SGTokenLike;
    }): SGAttribute {
        return new SGAttribute({
            key: this.toSGToken(options.key),
            equals: this.toSGToken(options.equals ?? '='),
            openingQuote: this.toSGToken(options.openingQuote ?? '"'),
            value: this.toSGToken(options.value ?? ''),
            closingQuote: this.toSGToken(options.closingQuote ?? '"')
        });
    }

    /**
     * Create a generic SceneGraph xml element. `startTagName` is required
     */
    public createSGElement(options: SGElementFactoryOptions & { startTagName: SGTokenLike }): SGElement {
        return new SGElement(this.getSGElementOptions(options, undefined, true));
    }

    /**
     * Create the xml prolog (i.e. `<?xml version="1.0" encoding="utf-8" ?>`)
     */
    public createSGProlog(options?: SGElementFactoryOptions): SGProlog {
        return new SGProlog(this.getSGElementOptions({ startTagOpen: '<?', startTagClose: '?>', ...options }, 'xml', true));
    }

    /**
     * Create a SceneGraph node element (i.e. `<Label />`). `startTagName` is required
     */
    public createSGNode(options: SGElementFactoryOptions & { startTagName: SGTokenLike }): SGNode {
        return new SGNode(this.getSGElementOptions(options, undefined, true));
    }

    /**
     * Create a `<children>` element
     */
    public createSGChildren(options?: SGElementFactoryOptions): SGChildren {
        return new SGChildren(this.getSGElementOptions(options, 'children', false));
    }

    /**
     * Create a `<customization>` element
     */
    public createSGCustomization(options?: SGElementFactoryOptions): SGCustomization {
        return new SGCustomization(this.getSGElementOptions(options, 'customization', false));
    }

    /**
     * Create a `<script>` element
     */
    public createSGScript(options?: SGElementFactoryOptions): SGScript {
        return new SGScript(this.getSGElementOptions(options, 'script', true));
    }

    /**
     * Create an interface `<field>` element
     */
    public createSGInterfaceField(options?: SGElementFactoryOptions): SGInterfaceField {
        return new SGInterfaceField(this.getSGElementOptions(options, 'field', true));
    }

    /**
     * Create an interface `<function>` element
     */
    public createSGInterfaceFunction(options?: SGElementFactoryOptions): SGInterfaceFunction {
        return new SGInterfaceFunction(this.getSGElementOptions(options, 'function', true));
    }

    /**
     * Create an `<interface>` element
     */
    public createSGInterface(options?: SGElementFactoryOptions): SGInterface {
        return new SGInterface(this.getSGElementOptions(options, 'interface', false));
    }

    /**
     * Create a `<component>` element
     */
    public createSGComponent(options?: SGElementFactoryOptions): SGComponent {
        return new SGComponent(this.getSGElementOptions(options, 'component', false));
    }

    public createSGAst(options?: {
        prologElement?: SGProlog;
        rootElement?: SGElement;
        componentElement?: SGComponent;
    }): SGAst {
        return new SGAst(options);
    }
}
