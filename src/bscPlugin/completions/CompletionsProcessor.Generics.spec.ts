import { Program } from '../../Program';
import { expectCompletionsIncludes, expectCompletionsExcludes, rootDir } from '../../testHelpers.spec';
import { util } from '../../util';
import { CompletionItemKind } from 'vscode-languageserver';

describe('CompletionsProcessor generics', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    it('offers type parameters as types inside the generic declaration only', () => {
        program.setFile('source/main.bs', `
            function first<T>(items as T[]) as T
                value = items[0] as T
                return value
            end function

            class Queue<Item>
                sub push(item as Item)
                end sub
            end class

            sub other(x as integer)
            end sub
        `);
        program.validate();

        //value = items[0] as |T
        let completions = program.getCompletions('source/main.bs', util.createPosition(2, 37));
        expectCompletionsIncludes(completions, [{
            label: 'T',
            kind: CompletionItemKind.TypeParameter
        }]);
        expectCompletionsExcludes(completions, ['Item']);

        //sub push(item as |Item)
        completions = program.getCompletions('source/main.bs', util.createPosition(7, 33));
        expectCompletionsIncludes(completions, ['Item']);
        expectCompletionsExcludes(completions, ['T']);

        //sub other(x as |integer)
        completions = program.getCompletions('source/main.bs', util.createPosition(11, 27));
        expectCompletionsExcludes(completions, ['T', 'Item']);
    });
});
