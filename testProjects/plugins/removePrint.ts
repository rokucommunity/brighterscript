import { CompilerPlugin, ProgramBuilder, BrsFile } from '../../dist';
import { EmptyStatement } from '../../dist/parser';
import { createStatementEditor, editStatements } from '../../dist/astUtils';

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'removePrint',
    fileParsed
};
export default pluginInterface;

function fileParsed(file: BrsFile) {
    // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
    file.parser.functionExpressions.forEach((fun) => {
        const visitor = createStatementEditor({
            PrintStatement: (statement) => new EmptyStatement()
        });
        editStatements(fun.body, visitor);
    });
}
