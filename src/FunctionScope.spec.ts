import { expect } from './chai-config.spec';

import { FunctionScope } from './FunctionScope';
import type { FunctionExpression } from './parser/Expression';
import { Program } from './Program';

describe('FunctionScope', () => {
    let scope: FunctionScope;
    let rootDir = process.cwd();
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        scope = new FunctionScope(null as any as FunctionExpression);
    });

    afterEach(() => {
        program.dispose();
    });

    describe('getVariablesAbove', () => {
        it('returns empty array when there are no variables found', () => {
            let variables = scope.getVariablesAbove(10);
            expect(variables).to.be.lengthOf(0);
        });

        it('returns variables defined above the specified line number', () => {
            let file = program.setFile('source/main.brs', `
                sub main()
                    var1 = 1
                    var2 = 2
                    var3 = 3
                end sub
            `);
            expect(file.functionScopes[0].getVariablesAbove(2)).to.be.lengthOf(0);
            expect(file.functionScopes[0].getVariablesAbove(3)).to.be.lengthOf(1);
            expect(file.functionScopes[0].getVariablesAbove(3)[0].name).to.equal('var1');
            expect(file.functionScopes[0].getVariablesAbove(4)).to.be.lengthOf(2);

        });
    });
});
