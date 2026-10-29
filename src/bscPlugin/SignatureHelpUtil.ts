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
        let signatureHelpItems: SignatureInfoObj[] = [];
        let codeSegment = callExpressionInfo.codeSegment;
        let dotPart = callExpressionInfo.dotPart;
        let name = callExpressionInfo.name;
        let results = new Map<string, SignatureInfoObj>();

        switch (callExpressionInfo.type) {
            case CallExpressionType.namespaceCall:
                signatureHelpItems = codeSegment.program.getStatementsByName(name, codeSegment, dotPart).map((fileLink) => this.getSignatureHelpForStatement(fileLink, dotPart));
                break;

            case CallExpressionType.myClassCall:
                let statement = codeSegment.getClassMethod(callExpressionInfo.myClass, name, true);
                if (statement) {
                    signatureHelpItems = [this.getSignatureHelpForStatement({ item: statement, codeSegment: codeSegment })];
                }
                break;

            case CallExpressionType.otherClassCall:
                signatureHelpItems = codeSegment.program.getStatementsByName(name, codeSegment).filter((fileLink) => isClassStatement(fileLink.item.parent)).map((fileLink) => this.getSignatureHelpForStatement(fileLink));
                break;

            case CallExpressionType.callFunc:
                // must be from some call func interface method
                signatureHelpItems = [];
                for (const scope of codeSegment.program.getScopes().filter((s) => isXmlScope(s))) {
                    signatureHelpItems.push(...codeSegment.program.getStatementsForXmlFile(scope as XmlScope, name).map((fileLink) => this.getSignatureHelpForStatement(fileLink)));
                }
                break;

            case CallExpressionType.call:
                signatureHelpItems = codeSegment.program.getStatementsByName(name, codeSegment).map((fileLink) => this.getSignatureHelpForStatement(fileLink));
                break;
            case CallExpressionType.constructorCall:
                let classItem = codeSegment.getClassFileLink(dotPart ? `${dotPart}.${name}` : name);
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
        let codeSegment = fileLink.codeSegment;

        if (!isFunctionStatement(statement) && !isMethodStatement(statement)) {
            return undefined;
        }
        const func = statement.func;
        const funcStartPosition = func.location?.range.start;

        // Get function comments in reverse order
        const trivia = util.concatAnnotationLeadingTrivia(func).reverse();
        let functionComments = [] as string[];

        for (const currentToken of trivia) {
            if (!currentToken) {
                break;
            }
            if (currentToken.location?.range.start.line + 1 < funcStartPosition.line) {
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
            } else if (kind === TokenKind.Whitespace) {
            } else {
                break;
            }
        }

        const documentation = functionComments.join('').trim();

        let key = statement.tokens.name.text + documentation;
        const params = [] as ParameterInformation[];
        for (const param of func.parameters) {
            params.push(ParameterInformation.create(param.tokens.name.text));
            key += param.tokens.name.text;
        }

        //read the label from the code (not the file), since the code may be embedded partway into its file
        let label = codeSegment.getText(util.createRangeFromPositions(func.tokens.functionType?.location?.range.start, func.body.location?.range.start)).trim();
        if (namespaceName) {
            label = label.replace(/^(sub | function )/gim, `$1${namespaceName}.`);
        }
        const signature = SignatureInformation.create(label, documentation, ...params);
        const index = 1;
        return { key: key, signature: signature, index: index };
    }

    public getClassSignatureHelp(fileLink: FileLink<ClassStatement>): SignatureInfoObj | undefined {
        let codeSegment = fileLink.codeSegment;
        let classStatement = fileLink.item;

        const classConstructor = codeSegment.getClassMethod(classStatement, 'new');
        let sigHelp = classConstructor ? this.getSignatureHelpForStatement({ item: classConstructor, codeSegment: codeSegment }) : undefined;
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
