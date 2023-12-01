import undent from 'undent';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import { ParseMode } from '../../parser/Parser';
import type { ComponentStatement, FunctionStatement } from '../../parser/Statement';
import { Cache } from '../../Cache';
import * as path from 'path';
import { util } from '../../util';
import type { ProvideFileEvent } from '../../interfaces';
import { isDottedGetExpression, isFieldStatement, isMethodStatement, isVariableExpression } from '../../astUtils/reflection';
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
                //force the desetPath for this component to be within the `pkg:/components` folder
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
                return `<field id="${member.name.text}" type="${member.typeExpression.getName()}" />`;
            } else {
                return '';
            }
        }).filter(x => !!x);

        xmlFile.parse(undent`
            <component name="${name}" extends="${statement.getParentName(ParseMode.BrightScript) ?? 'Group'}">
                <script uri="${util.sanitizePkgPath(file.destPath)}" />
                <script uri="${util.sanitizePkgPath(codebehindFile.destPath)}" />
                ${interfaceMembers.length > 0 ? '<interface>' : ''}
                    ${interfaceMembers.join('\n                    ')}
                ${interfaceMembers.length > 0 ? '</interface>' : ''}
            </component>
        `);


        this.event.files.push(xmlFile);
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
                initFunc.func.getSymbolTable().pushParentProvider(() => statement.getSymbolTable());
            }
            initFunc.func.body.statements.unshift(...initStatements);
        }

        //TODO these are hacks that we need until scope has been refactored to leverate the AST directly
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
