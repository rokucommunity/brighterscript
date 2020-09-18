import { isBrsFile, isClassStatement } from '../astUtils';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';
import { CompilerPlugin } from '../interfaces';

export class DeclarationResolver implements CompilerPlugin {
    public name = 'bsc:DeclarationResolver';

    afterFileParse(file: XmlFile | BrsFile) {
        //skip this file if it's not brs/bs, or if it already has declarations defined
        if (!isBrsFile(file) || file.declarations) {
            return;
        }

        file.declarations = {
            classStatements: []
        };

        file.walkStatements((statement, parent) => {
            if (isClassStatement(statement)) {
                file.declarations.classStatements.push(statement);
            }
        });
    }
}
