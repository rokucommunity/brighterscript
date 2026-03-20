import { isBrsFile, isClassStatement, isDottedGetExpression, isImportStatement, isNamespaceStatement, isXmlFile, isXmlScope } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideDefinitionEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { Location, LocationLink, Range } from 'vscode-languageserver-protocol';
import type { ClassStatement, FunctionStatement, NamespaceStatement } from '../../parser/Statement';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';
import { URI } from 'vscode-uri';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { Token } from '../../lexer/Token';
import type { XmlFile } from '../../files/XmlFile';
import type { SGAttribute, SGNode } from '../../parser/SGTypes';

export class DefinitionProvider {
    constructor(
        private event: ProvideDefinitionEvent
    ) { }

    public process(): Array<Location | LocationLink> {
        if (isBrsFile(this.event.file)) {
            this.brsFileGetDefinition(this.event.file);
        } else if (isXmlFile(this.event.file)) {
            this.xmlFileGetDefinition(this.event.file);
        }
        return this.event.definitions;
    }

    /**
     * Given a string that may be a file path and an origin range, try to resolve the path to a
     * file in the program. Returns a LocationLink (with originSelectionRange set so VS Code
     * underlines the whole path as one unit on Ctrl+hover) when the file is found, or null.
     * Only considers strings that start with a recognised path prefix:
     *   pkg:/, libpkg:/, ./, ../
     */
    private tryGetFilePathLocationLink(pathStr: string, containingFilePkgPath: string, originRange: Range): LocationLink | null {
        if (!pathStr) {
            return null;
        }
        // Require a recognised path prefix so we don't accidentally match arbitrary strings
        // (e.g. component names in createObject calls).
        if (!/^(?:pkg:|libpkg:|\.\/|\.\.\/)/i.test(pathStr)) {
            return null;
        }
        const pkgPath = util.getPkgPathFromTarget(containingFilePkgPath, pathStr);
        if (!pkgPath) {
            return null;
        }
        const targetFile = this.event.program.getFile(pkgPath);
        if (!targetFile) {
            return null;
        }
        return {
            originSelectionRange: originRange,
            targetUri: util.pathToUri(targetFile.srcPath),
            targetRange: util.createRange(0, 0, 0, 0),
            targetSelectionRange: util.createRange(0, 0, 0, 0)
        };
    }

    /**
     * For a position in a BrsFile, get the location where the token at that position was defined
     */
    private brsFileGetDefinition(file: BrsFile): void {
        //get the token at the position
        const token = file.getTokenAt(this.event.position);

        // While certain other tokens are allowed as local variables (AllowedLocalIdentifiers: https://github.com/rokucommunity/brighterscript/blob/master/src/lexer/TokenKind.ts#L418), these are converted by the parser to TokenKind.Identifier by the time we retrieve the token using getTokenAt
        let definitionTokenTypes = [
            TokenKind.Identifier,
            TokenKind.StringLiteral
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return;
        }

        const scopesForFile = this.event.program.getScopesForFile(file);
        const [scope] = scopesForFile;

        const expression = file.getClosestExpression(this.event.position);
        if (scope && expression) {
            scope.linkSymbolTable();
            let containingNamespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');

            //find a constant with this name
            const constant = scope?.getConstFileLink(fullName, containingNamespace);
            if (constant) {
                this.event.definitions.push(
                    util.createLocation(
                        URI.file(constant.file.srcPath).toString(),
                        constant.item.tokens.name.range
                    )
                );
                return;
            }
            if (isDottedGetExpression(expression)) {

                const enumLink = scope.getEnumFileLink(fullName, containingNamespace);
                if (enumLink) {
                    this.event.definitions.push(
                        util.createLocation(
                            URI.file(enumLink.file.srcPath).toString(),
                            enumLink.item.tokens.name.range
                        )
                    );
                    return;
                }
                const enumMemberLink = scope.getEnumMemberFileLink(fullName, containingNamespace);
                if (enumMemberLink) {
                    this.event.definitions.push(
                        util.createLocation(
                            URI.file(enumMemberLink.file.srcPath).toString(),
                            enumMemberLink.item.tokens.name.range
                        )
                    );
                    return;
                }
            }
        }

        let textToSearchFor = token.text.toLowerCase();

        const previousToken = file.getTokenAt({ line: token.range.start.line, character: token.range.start.character });

        if (previousToken?.kind === TokenKind.Callfunc) {
            for (const scope of this.event.program.getScopes()) {
                //does this xml file declare this function in its interface?
                if (isXmlScope(scope)) {
                    const apiFunc = scope.xmlFile.ast?.component?.api?.functions?.find(x => x.name.toLowerCase() === textToSearchFor); // eslint-disable-line @typescript-eslint/no-loop-func
                    if (apiFunc) {
                        this.event.definitions.push(
                            util.createLocation(util.pathToUri(scope.xmlFile.srcPath), apiFunc.range)
                        );
                        const callable = scope.getAllCallables().find((c) => c.callable.name.toLowerCase() === textToSearchFor); // eslint-disable-line @typescript-eslint/no-loop-func
                        if (callable) {
                            this.event.definitions.push(
                                util.createLocation(util.pathToUri((callable.callable.file as BrsFile).srcPath), callable.callable.functionStatement.name.range)
                            );
                        }
                    }
                }
            }
            return;
        }

        // eslint-disable-next-line @typescript-eslint/dot-notation
        let classToken = file['getTokenBefore'](token, TokenKind.Class);
        if (classToken) {
            let cs = file.parser.ast.findChild<ClassStatement>((klass) => isClassStatement(klass) && klass.classKeyword.range === classToken.range);
            if (cs?.parentClassName) {
                const nameParts = cs.parentClassName.getNameParts();
                let extendedClass = file.getClassFileLink(nameParts[nameParts.length - 1], nameParts.slice(0, -1).join('.'));
                if (extendedClass) {
                    this.event.definitions.push(util.createLocation(util.pathToUri(extendedClass.file.srcPath), extendedClass.item.range));
                }
            }
            return;
        }

        if (token.kind === TokenKind.StringLiteral) {
            if (isImportStatement(expression)) {
                const pkgPath = util.getPkgPathFromTarget(file.pkgPath, expression.filePath);
                const importedFile = this.event.program.getFile(pkgPath);
                if (importedFile) {
                    this.event.definitions.push(
                        util.createLocation(
                            URI.file(importedFile.srcPath).toString(),
                            util.createRange(1, 0, 1, 0)
                        )
                    );
                    return;
                }
            }

            // Generic file path detection: if the string literal looks like a file path
            // (pkg:/, libpkg:/, ./, ../) resolve it and navigate to that file.
            const pathStr = token.text.replace(/^"|"$/g, '');
            const link = this.tryGetFilePathLocationLink(
                pathStr,
                file.pkgPath,
                util.createRange(
                    token.range.start.line,
                    token.range.start.character + 1,
                    token.range.end.line,
                    token.range.end.character - 1
                )
            );
            if (link) {
                this.event.definitions.push(link);
                return;
            }

            // We need to strip off the quotes but only if present
            const startIndex = textToSearchFor.startsWith('"') ? 1 : 0;

            let endIndex = textToSearchFor.length;
            if (textToSearchFor.endsWith('"')) {
                endIndex--;
            }
            textToSearchFor = textToSearchFor.substring(startIndex, endIndex);
        }

        //look through local variables first, get the function scope for this position (if it exists)
        const functionScope = file.getFunctionScopeAtPosition(this.event.position);
        if (functionScope) {
            //find any variable or label with this name
            for (const varDeclaration of functionScope.variableDeclarations) {
                //we found a variable declaration with this token text!
                if (varDeclaration.name.toLowerCase() === textToSearchFor) {
                    const uri = util.pathToUri(file.srcPath);
                    this.event.definitions.push(util.createLocation(uri, varDeclaration.nameRange));
                }
            }
            // eslint-disable-next-line @typescript-eslint/dot-notation
            if (file['tokenFollows'](token, TokenKind.Goto)) {
                for (const label of functionScope.labelStatements) {
                    if (label.name.toLocaleLowerCase() === textToSearchFor) {
                        const uri = util.pathToUri(file.srcPath);
                        this.event.definitions.push(util.createLocation(uri, label.nameRange));
                    }
                }
            }
        }

        const filesSearched = new Set<BrsFile>();
        //look through all files in scope for matches
        for (const scope of scopesForFile) {
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || filesSearched.has(file)) {
                    continue;
                }
                filesSearched.add(file);

                if (previousToken?.kind === TokenKind.Dot && file.parseMode === ParseMode.BrighterScript) {
                    this.event.definitions.push(...file.getClassMemberDefinitions(textToSearchFor, file));
                    const namespaceDefinition = this.brsFileGetDefinitionsForNamespace(token, file);
                    if (namespaceDefinition) {
                        this.event.definitions.push(namespaceDefinition);
                    }
                }

                file.parser.ast.walk(createVisitor({
                    FunctionStatement: (statement: FunctionStatement) => {
                        if (statement.getName(file.parseMode).toLowerCase() === textToSearchFor) {
                            const uri = util.pathToUri(file.srcPath);
                            this.event.definitions.push(util.createLocation(uri, statement.range));
                        }
                    }
                }), {
                    walkMode: WalkMode.visitStatements
                });
            }
        }
    }


    private brsFileGetDefinitionsForNamespace(token: Token, file: BrsFile): Location {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (!token) {
            return undefined;
        }
        let location;

        const nameParts = (this.event.file as BrsFile).getPartialVariableName(token, [TokenKind.New]).split('.');
        const endName = nameParts[nameParts.length - 1].toLowerCase();
        const namespaceName = nameParts.slice(0, -1).join('.').toLowerCase();

        const statementHandler = (statement: NamespaceStatement) => {
            if (!location && statement.getName(ParseMode.BrighterScript).toLowerCase() === namespaceName) {
                const namespaceItemStatementHandler = (statement: ClassStatement | FunctionStatement) => {
                    if (!location && statement.name.text.toLowerCase() === endName) {
                        const uri = util.pathToUri(file.srcPath);
                        location = util.createLocation(uri, statement.range);
                    }
                };

                file.parser.ast.walk(createVisitor({
                    ClassStatement: namespaceItemStatementHandler,
                    FunctionStatement: namespaceItemStatementHandler
                }), {
                    walkMode: WalkMode.visitStatements
                });

            }
        };

        file.parser.ast.walk(createVisitor({
            NamespaceStatement: statementHandler
        }), {
            walkMode: WalkMode.visitStatements
        });

        return location;
    }

    private xmlFileGetDefinition(file: XmlFile) {
        //if the position is within the file's parent component name
        if (
            isXmlFile(file) &&
            file.parentComponent &&
            file.parentComponentName &&
            util.rangeContains(file.parentComponentName.range, this.event.position)
        ) {
            this.event.definitions.push({
                range: util.createRange(0, 0, 0, 0),
                uri: util.pathToUri(file.parentComponent.srcPath)
            });
            return;
        }

        // Generic XML attribute value path resolution.
        // Walk the entire component tree (component attributes, script tags, children nodes,
        // customization nodes) and return a definition for the first attribute value that
        // looks like a file path and resolves to a known file.
        const component = file.ast?.component;
        if (!component) {
            return;
        }

        // Component-level attributes (e.g. extends="...")
        if (this.xmlGetFilePathDefinitionFromAttributes(component.attributes, file.pkgPath)) {
            return;
        }
        // <script> tags (uri="...")
        for (const script of component.scripts ?? []) {
            if (this.xmlGetFilePathDefinitionFromAttributes(script.attributes, file.pkgPath)) {
                return;
            }
        }
        // Nodes inside <children>
        if (component.children && this.xmlWalkNodeForFilePath(component.children, file.pkgPath)) {
            return;
        }
        // <Customization> nodes
        for (const custom of component.customizations ?? []) {
            if (this.xmlWalkNodeForFilePath(custom, file.pkgPath)) {
                return;
            }
        }
    }

    /**
     * Check all attributes on an XML element for an attribute value that looks like a file path
     * and whose range contains the cursor position.  Returns true and pushes a definition when a
     * match is found.
     * For XML, we attempt to resolve every attribute value (no prefix requirement) since most
     * non-path values (e.g. name="MainScene") will simply not resolve to a known file.
     */
    private xmlGetFilePathDefinitionFromAttributes(attributes: SGAttribute[], pkgPath: string): boolean {
        for (const attr of attributes ?? []) {
            if (attr.value?.range && util.rangeContains(attr.value.range, this.event.position)) {
                const attrValue = attr.value.text;
                if (!attrValue) {
                    continue;
                }
                const resolvedPkgPath = util.getPkgPathFromTarget(pkgPath, attrValue);
                if (resolvedPkgPath) {
                    const targetFile = this.event.program.getFile(resolvedPkgPath);
                    if (targetFile) {
                        this.event.definitions.push({
                            originSelectionRange: attr.value.range,
                            targetUri: util.pathToUri(targetFile.srcPath),
                            targetRange: util.createRange(0, 0, 0, 0),
                            targetSelectionRange: util.createRange(0, 0, 0, 0)
                        });
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Recursively walk an SGNode and its children looking for an attribute value that looks like a
     * file path at the cursor position.  Returns true and pushes a definition on first match.
     */
    private xmlWalkNodeForFilePath(node: SGNode, pkgPath: string): boolean {
        if (this.xmlGetFilePathDefinitionFromAttributes(node.attributes, pkgPath)) {
            return true;
        }
        for (const child of node.children ?? []) {
            if (this.xmlWalkNodeForFilePath(child, pkgPath)) {
                return true;
            }
        }
        return false;
    }
}
