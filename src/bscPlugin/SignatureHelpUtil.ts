import { ParameterInformation, SignatureInformation } from 'vscode-languageserver-protocol';
import { isClassStatement, isXmlScope, isFunctionStatement, isMethodStatement } from '../astUtils/reflection';
import { TokenKind } from '../lexer/TokenKind';
import type { Statement } from '../parser/AstNode';
import { ParseMode } from '../parser/Parser';
import type { ClassStatement } from '../parser/Statement';
import type { SignatureInfoObj } from '../Program';
import type { XmlScope } from '../XmlScope';
import type { CallExpressionInfo } from './CallExpressionInfo';
import { CallExpressionType } from './CallExpressionInfo';
import type { FileLink } from '../interfaces';
import { util } from '../util';

export class SignatureHelpUtil {
    getSignatureHelpItems(callExpressionInfo: CallExpressionInfo): SignatureInfoObj[] {
        let signatureHelpItems = [];
        let file = callExpressionInfo.file;
        let dotPart = callExpressionInfo.dotPart;
        let name = callExpressionInfo.name;
        let results = new Map<string, SignatureInfoObj>();

        switch (callExpressionInfo.type) {
            case CallExpressionType.namespaceCall:
                signatureHelpItems = file.program.getStatementsByName(name, file, dotPart).map((fileLink) => this.getSignatureHelpForStatement(fileLink, dotPart));
                break;

            case CallExpressionType.myClassCall:
                let statement = file.getClassMethod(callExpressionInfo.myClass, name, true);
                if (statement) {
                    signatureHelpItems = [this.getSignatureHelpForStatement({ item: statement, file: file })];
                }
                break;

            case CallExpressionType.otherClassCall:
                signatureHelpItems = file.program.getStatementsByName(name, file).filter((fileLink) => isClassStatement(fileLink.item.parent)).map((fileLink) => this.getSignatureHelpForStatement(fileLink));
                break;

            case CallExpressionType.callFunc:
                // must be from some call func interface method
                signatureHelpItems = [];
                for (const scope of file.program.getScopes().filter((s) => isXmlScope(s))) {
                    signatureHelpItems.push(...file.program.getStatementsForXmlFile(scope as XmlScope, name).map((fileLink) => this.getSignatureHelpForStatement(fileLink)));
                }
                break;

            case CallExpressionType.call:
                signatureHelpItems = file.program.getStatementsByName(name, file).map((fileLink) => this.getSignatureHelpForStatement(fileLink));
                break;
            case CallExpressionType.constructorCall:
                let classItem = file.getClassFileLink(dotPart ? `${dotPart}.${name}` : name);
                let constructorSignatureHelp = this.getClassSignatureHelp(classItem);
                if (constructorSignatureHelp) {
                    signatureHelpItems.push(constructorSignatureHelp);
                }
                break;
            default:
        }

        for (let sigHelp of signatureHelpItems) {
            if (!results.has[sigHelp.key]) {
                sigHelp.index = callExpressionInfo.parameterIndex;
                results.set(sigHelp.key, sigHelp);
            }
        }

        return [...results.values()];

    }

    public getSignatureHelpForStatement(fileLink: FileLink<Statement>, namespaceName?: string): SignatureInfoObj {
        let statement = fileLink.item;
        let file = fileLink.file;

        if (!isFunctionStatement(statement) && !isMethodStatement(statement)) {
            return undefined;
        }
        const func = statement.func;
        const funcStartPosition = func.range.start;

        // Get function comments in reverse order
        let currentToken = file.getTokenAt(funcStartPosition);
        let functionComments = [] as string[];
        while (currentToken) {
            currentToken = file.getPreviousToken(currentToken);

            if (!currentToken) {
                break;
            }
            if (currentToken.range.start.line + 1 < funcStartPosition.line) {
                if (functionComments.length === 0) {
                    break;
                }
            }

            const kind = currentToken.kind;
            if (kind === TokenKind.Comment) {
                // Strip off common leading characters to make it easier to read
                const commentText = currentToken.text.replace(/^[' *\/]+/, '');
                functionComments.unshift(commentText);
            } else if (kind === TokenKind.Newline) {
                if (functionComments.length === 0) {
                    continue;
                }
                // if we already had a new line as the last token then exit out
                if (functionComments[0] === currentToken.text) {
                    break;
                }
                functionComments.unshift(currentToken.text);
            } else {
                break;
            }
        }

        const documentation = functionComments.join('').trim();

        const lines = util.splitIntoLines(file.fileContents);
        let key = statement.name.text + documentation;
        const params = [] as ParameterInformation[];
        for (const param of func.parameters) {
            params.push(ParameterInformation.create(param.name.text));
            key += param.name.text;
        }

        let label = util.getTextForRange(lines, util.createRangeFromPositions(func.functionType.range.start, func.body.range.start)).trim();
        if (namespaceName) {
            label = label.replace(/^(sub | function )/gim, `$1${namespaceName}.`);
        }
        const signature = SignatureInformation.create(label, documentation, ...params);
        const index = 1;
        return { key: key, signature: signature, index: index };
    }

    public getClassSignatureHelp(fileLink: FileLink<ClassStatement>): SignatureInfoObj | undefined {
        let file = fileLink.file;
        let classStatement = fileLink.item;

        const classConstructor = file.getClassMethod(classStatement, 'new');
        let sigHelp = classConstructor ? this.getSignatureHelpForStatement({ item: classConstructor, file: file }) : undefined;
        let className = classStatement.getName(ParseMode.BrighterScript);
        if (sigHelp) {
            sigHelp.key = className;
            sigHelp.signature.label = sigHelp.signature.label.replace(/(function|sub) new/, sigHelp.key);
        } else {
            sigHelp = {
                key: className,
                signature: SignatureInformation.create(`${className}()`, ''),
                index: 0
            };
        }
        return sigHelp;
    }


}

