import type { AttributeCstNode, ContentCstNode, DocumentCstNode, ElementCstNode } from '@xml-tools/parser';
import * as parser from '@xml-tools/parser';
import { DiagnosticMessages } from '../DiagnosticMessages';
import util from '../util';
import { SGAst, SGProlog, SGChildren, SGComponent, SGInterfaceField, SGInterfaceFunction, SGInterface, SGNode, SGScript, SGAttribute } from './SGTypes';
import type { SGElement, SGToken, SGReferences } from './SGTypes';
import { isSGComponent } from '../astUtils/xml';
import type { BsDiagnostic } from '../interfaces';
import type { Location, Range } from 'vscode-languageserver';

export default class SGParser {

    /**
     * The AST of the XML document, not including the inline scripts
     */
    public ast: SGAst = new SGAst();

    public tokens: IToken[];

    /**
     * The list of diagnostics found during the parse process
     */
    public diagnostics = [] as BsDiagnostic[];

    /**
     * The options used to parse the file
     */
    public options: SGParseOptions;

    private _references: SGReferences;

    /**
     * These are initially extracted during parse-time, but will also be dynamically regenerated if need be.
     *
     * If a plugin modifies the AST, then the plugin should call SGAst#invalidateReferences() to force this object to refresh
     */
    get references(): SGReferences {
        if (this._references === undefined) {
            this.findReferences();
        }
        return this._references;
    }


    /**
     * Invalidates (clears) the references collection. This should be called anytime the AST has been manipulated.
     */
    invalidateReferences() {
        this._references = undefined;
    }

    /**
     * Walk the AST to extract references to useful bits of information
     */
    private findReferences() {
        this._references = this.emptySGReferences();

        const { componentElement } = this.ast;
        if (!componentElement) {
            return;
        }

        const nameAttr = componentElement.getAttribute('name');
        this._references.name = nameAttr?.tokens.value;
        const extendsAttr = componentElement.getAttribute('extends');
        if (extendsAttr?.tokens.value) {
            this._references.extends = extendsAttr.tokens.value;
        }

        for (const script of componentElement.scriptElements) {
            const uriAttr = script.getAttribute('uri');
            if (uriAttr?.tokens.value) {
                const uri = uriAttr.tokens.value.text;
                this._references.scriptTagImports.push({
                    filePathRange: uriAttr.tokens.value.location?.range,
                    text: uri,
                    destPath: util.getPkgPathFromTarget(this.options.destPath, uri)
                });
            }
        }
    }

    private sanitizeParseOptions(options: SGParseOptions) {
        options ??= {
            destPath: undefined
        };
        options.trackLocations ??= true;
        return options;
    }


    public parse(fileContents: string, options?: SGParseOptions) {
        this.options = this.sanitizeParseOptions(options);
        this.diagnostics = [];

        const { cst, tokenVector, lexErrors, parseErrors } = parser.parse(fileContents);
        this.tokens = tokenVector;

        if (lexErrors.length) {
            for (const err of lexErrors) {
                this.diagnostics.push({
                    ...DiagnosticMessages.syntaxError(`Syntax error: ${err.message}`),
                    location: this.getLocationFromRange(util.createRange(
                        err.line - 1,
                        err.column,
                        err.line - 1,
                        err.column + err.length
                    ))
                });
            }
        }
        if (parseErrors.length) {
            const err = parseErrors[0];
            const token = err.token;
            this.diagnostics.push({
                ...DiagnosticMessages.syntaxError(`Syntax error: ${err.message}`),
                location: this.getLocationFromRange(!isNaN(token.startLine) ? this.rangeFromToken(token) : util.createRange(0, 0, 0, Number.MAX_VALUE))
            });
        }

        const { prolog, root } = this.buildAST(cst as any);
        if (!root) {
            const token1 = tokenVector[0];
            const token2 = tokenVector[1];
            //whitespace before the prolog isn't allowed by the parser
            if (
                token1?.image.trim().length === 0 &&
                token2?.image.trim() === '<?xml'
            ) {
                this.diagnostics.push({
                    ...DiagnosticMessages.syntaxError('Syntax error: whitespace found before the XML prolog'),
                    location: this.getLocationFromRange(this.rangeFromToken(token1))
                });
            }
        }

        if (isSGComponent(root)) {
            this.ast = new SGAst({ prologElement: prolog, rootElement: root, componentElement: root });
        } else {
            if (root) {
                //error: not a component
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlUnexpectedTag(root.tokens.startTagName.text),
                    location: root.tokens.startTagName.location
                });
            }
            this.ast = new SGAst({ prologElement: prolog, rootElement: root });
        }
    }

    buildAST(cst: DocumentCstNode) {
        const { prolog: cstProlog, element } = cst.children;

        let prolog: SGProlog;
        if (cstProlog?.[0]) {
            const ctx = cstProlog[0].children;
            prolog = new SGProlog({
                // <?
                startTagOpen: this.createPartialToken(ctx.XMLDeclOpen[0], 0, 2),
                // xml
                startTagName: this.createPartialToken(ctx.XMLDeclOpen[0], 2, 3),
                attributes: this.mapAttributes(ctx.attribute),
                // ?>
                startTagClose: this.mapToken(ctx.SPECIAL_CLOSE[0])
            });
        }

        let root: SGElement;
        if (element.length > 0 && element[0]?.children?.Name) {
            root = this.mapElement(element[0]);
        }

        return {
            prolog: prolog,
            root: root
        };
    }

    mapElement({ children }: ElementCstNode): SGElement {
        const startTagOpen = this.mapToken(children.OPEN[0]);
        const startTagName = this.mapToken(children.Name[0]);
        const attributes = this.mapAttributes(children.attribute);
        const startTagClose = this.mapToken((children.SLASH_CLOSE ?? children.START_CLOSE)?.[0]);
        const endTagOpen = this.mapToken(children.SLASH_OPEN?.[0]);
        const endTagName = this.mapToken(children.END_NAME?.[0]);
        const endTagClose = this.mapToken(children.END?.[0]);

        const content = children.content?.[0];

        let constructorOptions = {
            startTagOpen: startTagOpen,
            startTagName: startTagName,
            attributes: attributes,
            startTagClose: startTagClose,
            elements: [],
            endTagOpen: endTagOpen,
            endTagName: endTagName,
            endTagClose: endTagClose
        };

        switch (startTagName.text) {
            case 'component':
                constructorOptions.elements = this.mapElements(content, ['interface', 'script', 'children', 'customization']);
                return new SGComponent(constructorOptions);
            case 'interface':
                constructorOptions.elements = this.mapElements(content, ['field', 'function']);
                return new SGInterface(constructorOptions);
            case 'field':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        location: startTagName.location,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                return new SGInterfaceField(constructorOptions);
            case 'function':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        location: startTagName.location,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                return new SGInterfaceFunction(constructorOptions);
            case 'script':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        location: startTagName.location,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                const script = new SGScript(constructorOptions);
                script.cdata = this.getCdata(content);
                return script;
            case 'children':
                constructorOptions.elements = this.mapNodes(content);
                return new SGChildren(constructorOptions);
            default:
                constructorOptions.elements = this.mapNodes(content);
                return new SGNode(constructorOptions);
        }
    }

    mapNode({ children }: ElementCstNode): SGNode {
        return new SGNode({
            //<
            startTagOpen: this.mapToken(children.OPEN[0]),
            // TagName
            startTagName: this.mapToken(children.Name[0]),
            attributes: this.mapAttributes(children.attribute),
            // > or />
            startTagClose: this.mapToken((children.SLASH_CLOSE ?? children.START_CLOSE)[0]),
            elements: this.mapNodes(children.content?.[0]),
            // </
            endTagOpen: this.mapToken(children.SLASH_OPEN?.[0]),
            // TagName
            endTagName: this.mapToken(children.END_NAME?.[0]),
            // >
            endTagClose: this.mapToken(children.END?.[0])
        });
    }

    mapElements(content: ContentCstNode, allow: string[]): SGElement[] {
        if (!content) {
            return [];
        }
        const { element } = content.children;
        const tags: SGElement[] = [];
        if (element) {
            for (const entry of element) {
                const name = entry.children.Name?.[0];
                if (name?.image) {
                    if (!allow.includes(name.image)) {
                        //unexpected tag
                        this.diagnostics.push({
                            ...DiagnosticMessages.xmlUnexpectedTag(name.image),
                            location: this.getLocationFromRange(this.rangeFromToken(name))
                        });
                    }
                    tags.push(this.mapElement(entry));
                } else {
                    //bad xml syntax...
                }
            }
        }
        return tags;
    }

    mapNodes(content: ContentCstNode): SGNode[] {
        if (!content) {
            return [];
        }
        const { element } = content.children;
        return element?.map(element => this.mapNode(element));
    }

    hasElements(content: ContentCstNode): boolean {
        return !!content?.children.element?.length;
    }

    getCdata(content: ContentCstNode): SGToken {
        if (!content) {
            return undefined;
        }
        const { CData } = content.children;
        return this.mapToken(CData?.[0]);
    }

    private mapToken(token: IToken): SGToken {
        if (token) {
            return {
                text: token.image,
                //TODO should this be coerced into a uri?
                location: util.createLocationFromRange(this.options.srcPath, this.rangeFromToken(token))
            };
        } else {
            return undefined;
        }
    }

    /**
     * Build SGAttributes from the underlying XML parser attributes array
     */
    mapAttributes(attributes: AttributeCstNode[]) {
        // this is a hot function and has been optimized, so don't refactor unless you know what you're doing...
        const result = [] as SGAttribute[];
        if (attributes) {
            // eslint-disable-next-line @typescript-eslint/prefer-for-of
            for (let i = 0; i < attributes.length; i++) {

                const children = attributes[i].children;
                const attr = new SGAttribute({ key: this.mapToken(children.Name[0]) });

                if (children.EQUALS) {
                    attr.tokens.equals = this.mapToken(children.EQUALS[0]);
                }
                if (children.STRING) {
                    const valueToken = children.STRING[0];
                    attr.tokens.openingQuote = this.createPartialToken(valueToken, 0, 1);
                    attr.tokens.value = this.createPartialToken(valueToken, 1, -2);
                    attr.tokens.closingQuote = this.createPartialToken(valueToken, -1, 1);
                }
                result.push(attr);
            }
        }
        return result;
    }

    /**
     * Create a partial token from the given token. This only supports single-line tokens.
     * @param token the offset to start the new token. If negative, subtracts from token.length
     * @param startOffset the offset to start the new token. If negative, subtracts from token.length
     * @param length the length of the text to keep. If negative, subtracts from token.length
     */
    public createPartialToken(token: IToken, startOffset: number, length?: number): SGToken {
        if (startOffset < 0) {
            startOffset = token.image.length + startOffset;
        }
        if (length === undefined) {
            length = token.image.length - startOffset;
        }
        if (length < 0) {
            length = token.image.length + length;
        }
        return {
            text: token.image.substring(startOffset, startOffset + length),
            //xmltools startLine is 1-based, we need 0-based which is why we subtract 1 below
            location: util.createLocation(
                token.startLine - 1,
                token.startColumn - 1 + startOffset,
                token.endLine - 1,
                token.startColumn - 1 + (startOffset + length),
                this.options.srcPath
            )
        };
    }

    /**
     * Create a range based on the xmltools token
     */
    public rangeFromToken(token: IToken) {
        return util.createRange(
            token.startLine - 1,
            token.startColumn - 1,
            token.endLine - 1,
            token.endColumn
        );
    }

    private emptySGReferences(): SGReferences {
        return {
            scriptTagImports: []
        };
    }

    private getLocationFromRange(range: Range): Location {
        return util.createLocationFromRange(util.pathToUri(this.options.srcPath), range);
    }
}

//not exposed by @xml-tools/parser
interface IToken {
    image: string;
    startOffset: number;
    startLine?: number;
    startColumn?: number;
    endOffset?: number;
    endLine?: number;
    endColumn?: number;
}

export interface CstNodeLocation {
    startOffset: number;
    startLine: number;
    startColumn?: number;
    endOffset?: number;
    endLine?: number;
    endColumn?: number;
}

export interface SGParseOptions {
    /**
     * Path to the file where this source code originated
     */
    srcPath?: string;

    destPath: string;
    /**
     * Should locations be tracked. If false, the `range` property will be omitted
     * @default true
     */
    trackLocations?: boolean;
}
