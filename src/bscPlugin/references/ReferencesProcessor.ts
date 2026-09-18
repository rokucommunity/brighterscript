import { util } from '../../util';
import { isBrsFile, isCallExpression, isClassStatement, isDottedGetExpression, isFunctionExpression, isNamespaceStatement, isVariableExpression, isXmlFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideReferencesEvent, Reference } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import { ParseMode } from '../../parser/Parser';
import type { NamespaceStatement } from '../../parser/Statement';
import type { Expression } from '../../parser/AstNode';

enum ReferenceType {
    constant = 'constant',
    call = 'call',
    callFunc = 'callFunc',
    enum = 'enum',
    enumMember = 'enumMember',
    unknown = 'unknown',
    variable = 'variable',
    class = 'class',
    namespaceFunctionCall = 'namespaceFunctionCall'
}

export class ReferencesProcessor {
    public constructor(
        private event: ProvideReferencesEvent
    ) {

    }

    public process() {
        let file = this.event.file as BrsFile;
        if (isBrsFile(file)) {
            const callSiteToken = file.getTokenAt(this.event.position);
            const searchFor = callSiteToken.text.toLowerCase();

            let [referenceType, expression] = this.getReferenceType(this.event);
            switch (referenceType) {
                case ReferenceType.constant:
                    this.event.references.push(
                        ...this.findConstantReferences(file, searchFor, expression)
                    );
                    break;
                case ReferenceType.call:
                    this.event.references.push(
                        ...this.findCallReferences(file, searchFor, expression)
                    );
                    break;
                case ReferenceType.callFunc:
                    this.event.references.push(
                        ...this.findCallFuncReferences(file, searchFor, expression)
                    );
                    break;
                case ReferenceType.enum:
                    this.event.references.push(
                        ...this.findEnumReferences(file, searchFor, expression)
                    );
                    break;
                case ReferenceType.enumMember:
                    this.event.references.push(
                        ...this.findEnumReferences(file, searchFor, expression)
                    );
                    break;
                    break;
                case ReferenceType.variable:
                    this.event.references.push(
                        ...this.findVariableReferences(file, searchFor, expression)
                    );
                    break;
                case ReferenceType.class:
                    this.event.references.push(
                        ...this.findClassReferences(file, searchFor, expression)
                    );
                    break;
                default:
                    console.log('Unknown reference type');
            }
        }

    }
    private findEnumReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');
        return this.findDottedGetReferences(file, fullName, expression);
    }

    private findConstantReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');
        return this.findDottedGetReferences(file, fullName, expression);
    }

    private findCallFuncReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        //TODO - can further limit this
        return this.findIdentifierReferences(file, searchFor, expression);
    }

    private findCallReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        return [
            ...this.findIdentifierReferences(file, searchFor, expression)
        ];
    }

    private findClassReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        let references: Reference[] = [];
        return references;
    }

    private findIdentifierReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        let references = [] as Reference[];

        for (const scope of this.event.scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            references.push({
                                srcPath: file.srcPath,
                                range: e.range
                            });
                        }
                    },
                    CallExpression: (e) => {
                        if ((e.callee as any)?.name?.text.toLowerCase() === searchFor) {
                            references.push({
                                srcPath: file.srcPath,
                                range: e.range
                            });
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        }


        return references;
    }

    private findDottedGetReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {
        let references = [] as Reference[];

        for (const scope of this.event.scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    DottedGetExpression: (e) => {
                        const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');
                        if (fullName === searchFor) {
                            references.push({
                                srcPath: file.srcPath,
                                range: e.range
                            });
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        }


        return references;
    }

    private getReferenceType(event: ProvideReferencesEvent): [ReferenceType, Expression?] {
        //get the token at the position
        let file = event.file as BrsFile;
        let position = event.position;
        const token = file.getTokenAt(position);

        // While certain other tokens are allowed as local variables (AllowedLocalIdentifiers: https://github.com/rokucommunity/brighterscript/blob/master/src/lexer/TokenKind.ts#L418), these are converted by the parser to TokenKind.Identifier by the time we retrieve the token using getTokenAt
        let definitionTokenTypes = [
            TokenKind.Identifier,
            TokenKind.StringLiteral
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return [ReferenceType.unknown, undefined];
        }

        const scopesForFile = file.program.getScopesForFile(file);
        const [scope] = scopesForFile;

        const expression = file.getClosestExpression(position);
        if (scope && expression) {
            scope.linkSymbolTable();
            let containingNamespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');

            //find a constant with this name
            const constant = scope?.getConstFileLink(fullName, containingNamespace);
            if (constant) {
                return [ReferenceType.constant, constant.item];
            }
            if (isDottedGetExpression(expression)) {

                const enumLink = scope.getEnumFileLink(fullName, containingNamespace);
                if (enumLink) {
                    return [ReferenceType.enum, enumLink.item];
                }
                const enumMemberLink = scope.getEnumMemberFileLink(fullName, containingNamespace);
                if (enumMemberLink) {
                    return [ReferenceType.enum, enumMemberLink.item];
                }
            } else if (isCallExpression(expression)) {
                // TODO CHECK THIS
                return [ReferenceType.namespaceFunctionCall, expression];
            }
        }

        const previousToken = file.getTokenAt({ line: token.range.start.line, character: token.range.start.character });

        if (previousToken?.kind === TokenKind.Callfunc) {
            return [ReferenceType.callFunc, expression];
        }

        let classToken = file.getTokenBefore(token, TokenKind.Class);
        if (classToken) {
            return [ReferenceType.class, expression];
        }

        if (token.kind === TokenKind.StringLiteral) {
            return [ReferenceType.unknown, undefined];
        }

        if (isCallExpression(expression)) {
            return [ReferenceType.call, expression];
        }

        if (isFunctionExpression(expression)) {
            return [ReferenceType.call, expression];
        }

        if (isClassStatement(expression)) {
            return [ReferenceType.class, expression];
        }

        if (isVariableExpression(expression)) {
            return [ReferenceType.variable, expression];
        }
        return [ReferenceType.call, expression];
    }

    private findVariableReferences(file: BrsFile, searchFor: string, expression?: Expression): Reference[] {

        let references = [] as Reference[];


        for (const scope of this.event.scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            references.push({
                                srcPath: file.srcPath,
                                range: e.range
                            });
                        }
                    },
                    AssignmentStatement: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            references.push({
                                srcPath: file.srcPath,
                                range: e.name.range
                            });
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        }
        return references;
    }
}
