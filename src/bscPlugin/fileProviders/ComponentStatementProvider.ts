import undent from 'undent';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import { ParseMode } from '../../parser/Parser';
import type { ComponentStatement } from '../../parser/Statement';
import { Cache } from '../../Cache';
import * as path from 'path';
import { util } from '../../util';
import type { ProvideFileEvent } from '../../interfaces';
import { isFieldStatement, isMethodStatement } from '../../astUtils/reflection';
import { createFunctionStatement, createAssignmentStatement } from '../../astUtils/creators';
import type { Statement } from '../../parser/AstNode';

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
                return `<field id="${member.name.text}" type="${member.type.text}" />`;
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
            srcPath: `virtual:/${destDir}/${name}.codebehind.brs`,
            destPath: `${destDir}/${name}.codebehind.brs`
        });
        const initStatements: Statement[] = [];
        //create AST from all the fields and methods in the component statement
        for (const member of statement.getMembers()) {
            if (isMethodStatement(member)) {
                //convert the method into a standard function
                file.ast.statements.push(
                    createFunctionStatement(member.name, member.func)
                );
                //if this is a private field, and it has a value
            } else if (isFieldStatement(member) && member.accessModifier.text.toLowerCase() === 'private' && member.initialValue) {
                //add private fields to the global m
                initStatements.push(
                    createAssignmentStatement({
                        name: member.name,
                        value: member.initialValue
                    })
                );
            }
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
}
