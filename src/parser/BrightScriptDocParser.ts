import type { GetSymbolTypeOptions } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import util from '../util';
import type { AstNode } from './AstNode';


const tagRegex = /@(\w+)(?:\s+(.*))?/;
const paramRegex = /(?:{([^}]*)}\s+)?(?:(\[?\w+\]?))\s*(.*)/;
const returnRegex = /(?:{([^}]*)})?\s*(.*)/;
const typeTagRegex = /(?:{([^}]*)})?/;

export enum BrsDocTagKind {
    Description = 'description',
    Param = 'param',
    Return = 'return',
    Type = 'type',
    Var = 'var'
}


export class BrightScriptDocParser {

    public parseNode(node: AstNode) {
        return this.parse(util.getNodeDocumentation(node, false));
    }

    public parse(documentation: string) {
        const brsDoc = new BrightScriptDoc(documentation);
        if (!documentation) {
            return brsDoc;
        }
        const lines = documentation.split('\n');
        const blockLines = [] as string[];
        const descriptionLines = [] as string[];
        let lastTag: BrsDocTag;
        function augmentLastTagWithBlockLines() {
            if (blockLines.length > 0 && lastTag) {
                // add to the description or details to previous tag
                if (typeof (lastTag as BrsDocWithDescription).description !== 'undefined') {
                    (lastTag as BrsDocWithDescription).description += '\n' + blockLines.join('\n');
                    (lastTag as BrsDocWithDescription).description = (lastTag as BrsDocWithDescription).description.trim();
                }
                if (typeof lastTag.detail !== 'undefined') {
                    lastTag.detail += '\n' + blockLines.join('\n');
                    lastTag.detail = lastTag.detail.trim();
                }
            }
            blockLines.length = 0;
        }
        for (let line of lines) {
            line = line.trim();
            while (line.startsWith('\'')) {
                // remove leading apostrophes
                line = line.substring(1).trim();
            }
            if (!line.startsWith('@')) {
                if (lastTag) {

                    blockLines.push(line);
                } else if (descriptionLines.length > 0 || line) {
                    // add a line to the list if it's not empty
                    descriptionLines.push(line);
                }
            } else {
                augmentLastTagWithBlockLines();
                const newTag = this.parseLine(line);
                lastTag = newTag;
                if (newTag) {
                    brsDoc.tags.push(newTag);
                }
            }
        }
        augmentLastTagWithBlockLines();
        brsDoc.description = descriptionLines.join('\n').trim();
        return brsDoc;
    }

    private parseLine(line: string) {
        line = line.trim();
        const match = tagRegex.exec(line);
        if (!match) {
            return;
        }
        const tagName = match[1];
        const detail = match[2] ?? '';

        switch (tagName) {
            case BrsDocTagKind.Param:
                return this.parseParam(detail);
            case BrsDocTagKind.Return:
            case 'returns':
                return this.parseReturn(detail);
            case BrsDocTagKind.Type:
                return this.parseType(detail);
            case BrsDocTagKind.Var:
                return { ...this.parseParam(detail), tagName: BrsDocTagKind.Var };
        }
        return {
            tagName: tagName,
            detail: detail
        };
    }

    private parseParam(detail: string): BrsDocParamTag {
        let type = '';
        let description = '';
        let optional = false;
        let paramName = '';
        let match = paramRegex.exec(detail);
        if (match) {
            type = match[1] ?? '';
            paramName = match[2] ?? '';
            description = match[3] ?? '';
        } else {
            paramName = detail.trim();
        }
        if (paramName) {
            optional = paramName.startsWith('[') && paramName.endsWith(']');
            paramName = paramName.replace(/\[|\]/g, '').trim();
        }
        return {
            tagName: BrsDocTagKind.Param,
            name: paramName,
            type: type,
            description: description,
            optional: optional,
            detail: detail
        };
    }

    private parseReturn(detail: string): BrsDocWithDescription {
        let match = returnRegex.exec(detail);
        let type = '';
        let description = '';
        if (match) {
            type = match[1] ?? '';
            description = match[2] ?? '';
        }
        return {
            tagName: BrsDocTagKind.Return,
            type: type,
            description: description,
            detail: detail
        };
    }

    private parseType(detail: string): BrsDocWithType {
        let match = typeTagRegex.exec(detail);
        let type = '';
        if (match) {
            if (match[1]) {
                type = match[1] ?? '';
            }
        }
        return {
            tagName: BrsDocTagKind.Type,
            type: type,
            detail: detail
        };
    }
}

export class BrightScriptDoc {

    protected _description: string;

    public tags = [] as BrsDocTag[];

    constructor(
        public readonly documentation: string
    ) {
    }

    set description(value: string) {
        this._description = value;
    }

    get description() {
        const descTag = this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Description;
        });

        let result = this._description ?? '';
        if (descTag) {
            const descTagDetail = descTag.detail;
            result = result ? result + '\n' + descTagDetail : descTagDetail;
        }
        return result.trim();
    }

    getParam(name: string) {
        const lowerName = name.toLowerCase();
        return this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Param && (tag as BrsDocParamTag).name.toLowerCase() === lowerName;
        }) as BrsDocParamTag;
    }

    getVar(name: string) {
        const lowerName = name.toLowerCase();
        return this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Var && (tag as BrsDocParamTag).name.toLowerCase() === lowerName;
        }) as BrsDocParamTag;
    }


    getReturn() {
        return this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Return || tag.tagName === 'returns';
        }) as BrsDocWithDescription;
    }

    getTypeTag() {
        return this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Type;
        }) as BrsDocWithType;
    }

    getTag(tagName: string) {
        return this.tags.find((tag) => {
            return tag.tagName === tagName;
        });
    }

    getAllTags(tagName: string) {
        return this.tags.filter((tag) => {
            return tag.tagName === tagName;
        });
    }

    getParamBscType(name: string, nodeContext: AstNode, options: GetSymbolTypeOptions) {
        const param = this.getParam(name);

        return this.getTypeFromContext(param?.type, nodeContext, options);
    }

    getVarBscType(name: string, nodeContext: AstNode, options: GetSymbolTypeOptions) {
        const param = this.getVar(name);

        return this.getTypeFromContext(param?.type, nodeContext, options);
    }

    getReturnBscType(nodeContext: AstNode, options: GetSymbolTypeOptions) {
        const retTag = this.getReturn();

        return this.getTypeFromContext(retTag?.type, nodeContext, options);
    }


    getTypeTagBscType(nodeContext: AstNode, options: GetSymbolTypeOptions) {
        const retTag = this.getTypeTag();
        return this.getTypeFromContext(retTag?.type, nodeContext, options);
    }

    getTypeFromContext(typeName: string, nodeContext: AstNode, options: GetSymbolTypeOptions) {
        // TODO: Add support for union types here
        const topSymbolTable = nodeContext?.getSymbolTable();
        if (!topSymbolTable || !typeName) {
            return undefined;
        }
        const fullName = typeName;
        const parts = typeName.split('.');
        const optionsToUse = {
            ...options,
            flags: SymbolTypeFlag.typetime,
            fullName: fullName,
            typeChain: undefined
        };
        let result = topSymbolTable.getSymbolType(parts.shift(), optionsToUse);
        while (result && parts.length > 0) {
            result = result.getMemberType(parts.shift(), optionsToUse);
        }
        return result;
    }
}

export interface BrsDocTag {
    tagName: string;
    detail?: string;
}
export interface BrsDocWithType extends BrsDocTag {
    type?: string;
}

export interface BrsDocWithDescription extends BrsDocWithType {
    description?: string;
}

export interface BrsDocParamTag extends BrsDocWithDescription {
    name: string;
    optional?: boolean;
}


export let brsDocParser = new BrightScriptDocParser();
export default brsDocParser;
