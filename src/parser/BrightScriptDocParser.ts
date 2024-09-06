import type { GetSymbolTypeOptions } from '../SymbolTable';
import util from '../util';
import type { AstNode, Expression } from './AstNode';
import type { Location } from 'vscode-languageserver';
import { Parser } from './Parser';
import type { ExpressionStatement } from './Statement';
import { isExpressionStatement } from '../astUtils/reflection';
import { SymbolTypeFlag } from '../SymbolTypeFlag';

const tagRegex = /@(\w+)(?:\s+(.*))?/;
const paramRegex = /(?:{([^}]*)}\s+)?(?:(\[?\w+\]?))\s*(.*)/;
const returnRegex = /(?:{([^}]*)})?\s*(.*)/;
const typeTagRegex = /(?:{([^}]*)})?/;

export enum BrsDocTagKind {
    Description = 'description',
    Param = 'param',
    Return = 'return',
    Type = 'type'
}

export class BrightScriptDocParser {

    public parseNode(node: AstNode) {
        const matchingLocations: Location[] = [];
        const result = this.parse(
            util.getNodeDocumentation(node, {
                prettyPrint: false,
                matchingLocations: matchingLocations
            }),
            matchingLocations);
        for (const tag of result.tags) {
            if ((tag as BrsDocWithType).typeExpression) {
                (tag as BrsDocWithType).typeExpression.symbolTable = node.getSymbolTable();
            }
        }
        return result;
    }

    public parse(documentation: string, matchingLocations: Location[] = []) {
        const brsDoc = new BrightScriptDoc(documentation);
        if (!documentation) {
            return brsDoc;
        }
        const lines = documentation.split('\n');
        const blockLines = [] as { line: string; location?: Location }[];
        const descriptionLines = [] as { line: string; location?: Location }[];
        let lastTag: BrsDocTag;
        let haveMatchingLocations = false;
        if (lines.length === matchingLocations.length) {
            // We locations for each line, so we can add Locations
            haveMatchingLocations = true;
        }
        function augmentLastTagWithBlockLines() {
            if (blockLines.length > 0 && lastTag) {
                // add to the description or details to previous tag
                if (typeof (lastTag as BrsDocWithDescription).description !== 'undefined') {
                    (lastTag as BrsDocWithDescription).description += '\n' + blockLines.map(obj => obj.line).join('\n');
                    (lastTag as BrsDocWithDescription).description = (lastTag as BrsDocWithDescription).description.trim();
                }
                if (typeof lastTag.detail !== 'undefined') {
                    lastTag.detail += '\n' + blockLines.map(obj => obj.line).join('\n');
                    lastTag.detail = lastTag.detail.trim();
                }
                if (haveMatchingLocations) {
                    lastTag.location = util.createBoundingLocation(lastTag.location, blockLines[blockLines.length - 1].location);
                }
            }
            blockLines.length = 0;
        }
        for (let line of lines) {
            let location = haveMatchingLocations ? matchingLocations.shift() : undefined;
            line = line.trim();
            while (line.startsWith('\'')) {
                // remove leading apostrophes
                line = line.substring(1).trim();
            }
            if (!line.startsWith('@')) {
                if (lastTag) {

                    blockLines.push({ line: line, location: location });
                } else if (descriptionLines.length > 0 || line) {
                    // add a line to the list if it's not empty
                    descriptionLines.push({ line: line, location: location });
                }
            } else {
                augmentLastTagWithBlockLines();
                const newTag = this.parseLine(line, location);
                lastTag = newTag;
                if (newTag) {
                    brsDoc.tags.push(newTag);
                }
            }
        }
        augmentLastTagWithBlockLines();
        brsDoc.description = descriptionLines.map(obj => obj.line).join('\n').trim();
        return brsDoc;
    }

    private parseLine(line: string, location?: Location) {
        line = line.trim();
        const match = tagRegex.exec(line);
        if (!match) {
            return;
        }
        const tagName = match[1];
        const detail = match[2] ?? '';

        switch (tagName) {
            case BrsDocTagKind.Param:
                return { ...this.parseParam(detail), location: location };
            case BrsDocTagKind.Return:
            case 'returns':
                return { ...this.parseReturn(detail), location: location };
            case BrsDocTagKind.Type:
                return { ...this.parseType(detail), location: location };
        }
        return {
            tagName: tagName,
            detail: detail,
            location: location
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
            typeString: type,
            typeExpression: this.getTypeExpressionFromTypeString(type),
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
            typeString: type,
            typeExpression: this.getTypeExpressionFromTypeString(type),
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
            typeString: type,
            typeExpression: this.getTypeExpressionFromTypeString(type),
            detail: detail
        };
    }

    private getTypeExpressionFromTypeString(typeString: string) {
        if (!typeString) {
            return undefined;
        }
        let result: Expression;
        try {
            let { ast } = Parser.parse(typeString);
            if (isExpressionStatement(ast?.statements?.[0])) {
                result = (ast.statements[0] as ExpressionStatement).expression;
            }
        } catch (e) {
            //ignore
        }
        return result;
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

    getTypeTagByName(name: string) {
        const lowerName = name.toLowerCase();
        return this.tags.find((tag) => {
            return tag.tagName === BrsDocTagKind.Type && (tag as BrsDocParamTag).name.toLowerCase() === lowerName;
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

    getParamBscType(name: string, options: GetSymbolTypeOptions = { flags: SymbolTypeFlag.typetime }) {
        const param = this.getParam(name);
        return param?.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime });
    }

    getReturnBscType(options: GetSymbolTypeOptions = { flags: SymbolTypeFlag.typetime }) {
        const retTag = this.getReturn();
        return retTag?.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime });
    }

    getTypeTagBscType(options: GetSymbolTypeOptions = { flags: SymbolTypeFlag.typetime }) {
        const typeTag = this.getTypeTag();
        return typeTag?.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime });
    }
}

export interface BrsDocTag {
    tagName: string;
    detail?: string;
    location?: Location;
}
export interface BrsDocWithType extends BrsDocTag {
    typeString?: string;
    typeExpression?: Expression;
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
