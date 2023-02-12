import undent from 'undent';
import { createFunctionStatement, ProvideFileEvent, Statement } from '../..';
import { createAssignmentStatement, isFieldStatement, isMethodStatement } from '../..';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import { ParseMode } from '../../parser/Parser';
import type { ComponentStatement } from '../../parser/Statement';
import { Cache } from '../../Cache';
import * as path from 'path';
import { util } from '../../util';

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
                //ensure the desetPath for the component resides within the `pkg:/components` folder
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
        xmlFile.parse(undent`
            <component name="${name}" extends="${statement.getParentName(ParseMode.BrightScript) ?? 'Group'}">
                <script uri="${util.sanitizePkgPath(file.destPath)}" />
                <script uri="${util.sanitizePkgPath(codebehindFile.destPath)}" />
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

        this.event.files.push(file);
        return file;
    }
}
