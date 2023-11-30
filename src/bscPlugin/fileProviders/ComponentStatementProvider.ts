import undent from 'undent';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import { ParseMode } from '../../parser/Parser';
import type { ComponentStatement, FunctionStatement } from '../../parser/Statement';
import { Cache } from '../../Cache';
import * as path from 'path';
import { util } from '../../util';
import type { ProvideFileEvent } from '../../interfaces';
import { isDottedGetExpression, isFieldStatement, isMethodStatement, isVariableExpression, isLiteralExpression, isTemplateStringExpression } from '../../astUtils/reflection';
import { createFunctionStatement, createFunctionExpression, createDottedSetStatement, createVariableExpression } from '../../astUtils/creators';
import type { Statement } from '../../parser/AstNode';
import { TokenKind } from '../../lexer/TokenKind';
import { VariableExpression } from '../../parser/Expression';

export class ComponentStatementProvider {
    constructor(
        private event: ProvideFileEvent
    ) {
    }


    /**
     * Create virtual files for every component statement found in this physical file
     */
    public process(file: BrsFile) {
        const cache = new Cache<string, string>();
        file.ast.walk(createVisitor({
            ComponentStatement: (node) => {
                //force the destPath for this component to be within the `pkg:/components` folder
                const destDir = cache.getOrAdd(file.srcPath, () => {
                    return path.dirname(file.destPath).replace(/^(.+?)(?=[\/\\]|$)/, (match: string, firstDirName: string) => {
                        return 'components';
                    });
                });

                this.registerComponent(file, node, destDir);
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
    }

    private registerComponent(file: BrsFile, statement: ComponentStatement, destDir: string) {
        let name = statement.getName(ParseMode.BrightScript);
        const codebehindFile = this.registerCodebehind(name, statement, destDir);

        const xmlFile = this.event.fileFactory.XmlFile({
            srcPath: `virtual:/${destDir}/${name}.xml`,
            destPath: `${destDir}/${name}.xml`
        });
        const interfaceMembers = statement.getMembers().map((member) => {
            //declare interface function
            if (isMethodStatement(member) && member.accessModifier?.text.toLowerCase() === 'public') {
                return `<function name="${member.name.text}" />`;

                //declare interface field
            } else if (isFieldStatement(member) && member.accessModifier?.text.toLowerCase() === 'public') {
                return `<field
                    id="${member.name.text}"
                    type="${member.typeExpression.getName()}"
                    alias="${this.getAnnotationValue(member.annotations?.filter(x => x.name.toLowerCase() === 'alias'))}"
                    onChange="${this.getAnnotationValue(member.annotations?.filter(x => x.name.toLowerCase() === 'onchange'))}"
                    alwaysNotify="${this.getAnnotationValue(member.annotations?.filter(x => x.name.toLowerCase() === 'alwaysnotify')) === 'true'}"
                />`;
            } else {
                return '';
            }
        }).filter(x => !!x);

        let componentChildren = '';
        const template = statement.annotations?.find(x => x.name.toLowerCase() === 'template');
        if (template) {
            componentChildren = `<children>${this.getAnnotationValue([template])}</children>`;
        }

        xmlFile.parse(undent`
            <component name="${name}" extends="${statement.getParentName(ParseMode.BrightScript) ?? 'Group'}">
                <script uri="${util.sanitizePkgPath(file.destPath)}" />
                <script uri="${util.sanitizePkgPath(codebehindFile.destPath)}" />
                ${interfaceMembers.length > 0 ? '<interface>' : ''}
                    ${interfaceMembers.join('\n                    ')}
                ${interfaceMembers.length > 0 ? '</interface>' : ''}
                ${componentChildren}
            </component>
        `);

        this.event.files.push(xmlFile);
    }

    private getAnnotationValue(annotations: any) {
        let response = [];
        annotations.forEach(a => {
            let args = a?.call?.args[0];
            if (isVariableExpression(args) || isDottedGetExpression(args)) {
                response.push(args.name.text);
            } else if (isLiteralExpression(args)) {
                let values = args?.token?.text.replaceAll('\"', '').replaceAll(' ', '').split(',');
                response = response.concat(values);
            } else if (isTemplateStringExpression(args)) {
                let textOutput = '';
                args.quasis[0]?.expressions?.forEach((a: { token: { text: string } }) => {
                    if (!a.token.text.includes('component>') && !a.token.text.includes('children>')) {
                        textOutput += a.token.text;
                    }
                });
                response.push(textOutput);
            }
        });

        response = response.filter((item, index) => {
            return response.indexOf(item) === index;
        });
        return response.join(', ');
    }

    private registerCodebehind(name: string, statement: ComponentStatement, destDir: string) {
        //create the codebehind file
        const file = this.event.fileFactory.BrsFile({
            srcPath: `virtual:/${destDir}/${name}.codebehind.bs`,
            destPath: `${destDir}/${name}.codebehind.brs`
        });
        const initStatements: Statement[] = [];
        let initFunc: FunctionStatement;
        //create AST from all the fields and methods in the component statement
        for (const member of statement.getMembers()) {
            if (isMethodStatement(member)) {
                const func = createFunctionStatement(member.name, member.func);
                //convert the method into a standard function
                file.ast.statements.push(func);

                if (member?.name?.text.toLowerCase() === 'init') {
                    initFunc = func;
                }
                this.rewriteMAccess(func);
                //if this is a private field, and it has a value
            } else if (isFieldStatement(member) && member.accessModifier?.text.toLowerCase() === 'private' && member.initialValue) {
                //add private fields to the global m
                initStatements.push(
                    createDottedSetStatement(
                        createVariableExpression('m'),
                        member.name.text,
                        member.initialValue
                    )
                );
            }
        }

        //push statements to the start of `init()`
        if (initStatements.length > 0) {
            //create the `init` function if it doesn't exist
            if (!initFunc) {
                initFunc = createFunctionStatement('init',
                    createFunctionExpression(TokenKind.Sub)
                );
                file.ast.statements.unshift(initFunc);
            }
            initFunc.func.body.statements.unshift(...initStatements);
        }

        //TODO these are hacks that we need until scope has been refactored to leverage the AST directly
        file.parser.invalidateReferences();
        // eslint-disable-next-line @typescript-eslint/dot-notation
        file['findCallables']();
        // eslint-disable-next-line @typescript-eslint/dot-notation
        file['findFunctionCalls']();

        this.event.files.push(file);
        return file;
    }

    private rewriteMAccess(func: FunctionStatement) {
        func.func.body.walk(createVisitor({
            CallExpression: (call) => {
                //if this is a `m.doSomething()` call, rewrite it to call the root level method
                if (isDottedGetExpression(call.callee) && isVariableExpression(call.callee.obj) && call.callee.obj.name.text?.toLowerCase() === 'm') {
                    call.callee = new VariableExpression(call.callee.name);
                }
            }
        }), {
            walkMode: WalkMode.visitAll
        });
    }
}
