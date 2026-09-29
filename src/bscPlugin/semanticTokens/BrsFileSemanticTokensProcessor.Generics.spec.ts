import { expect } from '../../chai-config.spec';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import type { BrsFile } from '../../files/BrsFile';
import { Program } from '../../Program';
import { expectZeroDiagnostics, rootDir } from '../../testHelpers.spec';
import { util } from '../../util';

describe('BrsFileSemanticTokensProcessor generics', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });
    afterEach(() => {
        program.dispose();
    });

    /**
     * Get the semantic tokens for the file as `type|range` strings
     */
    function getTokens(file: BrsFile) {
        program.validate();
        expectZeroDiagnostics(program);
        return util.sortByRange(program.getSemanticTokens(file.srcPath)).map(token => {
            return `${token.tokenType}|${util.rangeToString(token.range)}`;
        });
    }

    it('marks type parameter declarations and usages', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            function first<T>(items as T[]) as T
                return items[0]
            end function
        `);
        const tokens = getTokens(file);
        //function first<|T|>(items as T[]) as T
        expect(tokens).to.include(`${SemanticTokenTypes.typeParameter}|${util.rangeToString(util.createRange(1, 27, 1, 28))}`);
        //function first<T>(items as |T|[]) as T
        expect(tokens).to.include(`${SemanticTokenTypes.typeParameter}|${util.rangeToString(util.createRange(1, 39, 1, 40))}`);
        //function first<T>(items as T[]) as |T|
        expect(tokens).to.include(`${SemanticTokenTypes.typeParameter}|${util.rangeToString(util.createRange(1, 47, 1, 48))}`);
    });

    it('marks type parameters on classes and generic type usages', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            class Queue<T>
                sub push(item as T)
                end sub
            end class

            sub main(q as Queue<integer>)
                q.push(1)
            end sub
        `);
        const tokens = getTokens(file);
        //class Queue<|T|>
        expect(tokens).to.include(`${SemanticTokenTypes.typeParameter}|${util.rangeToString(util.createRange(1, 24, 1, 25))}`);
        //sub push(item as |T|)
        expect(tokens).to.include(`${SemanticTokenTypes.typeParameter}|${util.rangeToString(util.createRange(2, 33, 2, 34))}`);
        //sub main(q as |Queue|<integer>)
        expect(tokens).to.include(`${SemanticTokenTypes.class}|${util.rangeToString(util.createRange(6, 26, 6, 31))}`);
    });
});
