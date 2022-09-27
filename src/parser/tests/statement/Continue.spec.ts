import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { isContinueStatement } from '../../../astUtils/reflection';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TokenKind } from '../../../lexer/TokenKind';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { standardizePath as s } from '../../../util';
import type { BrsFile } from '../../../files/BrsFile';
const sinon = createSandbox();

describe('parser continue statements', () => {
    let rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('parses standalone statement properly', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                for i = 0 to 10
                    continue for
                end for
            end sub
        `);
        expectZeroDiagnostics(program);
        expect(file.ast.findChild(isContinueStatement)).to.exist;
    });

    it('flags incorrect loop type', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                for i = 0 to 10
                    continue while
                end for
                for each item in [1, 2, 3]
                    continue while
                end for
                while true
                    continue for
                end while
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.expectedToken(TokenKind.For),
            DiagnosticMessages.expectedToken(TokenKind.For),
            DiagnosticMessages.expectedToken(TokenKind.While)
        ]);
        expect(file.ast.findChild(isContinueStatement)).to.exist;
    });

    it('flags missing `for` or `while` but still creates the node', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                for i = 0 to 10
                    continue
                end for
            end sub
        `);
        expectDiagnostics(program, [
            DiagnosticMessages.expectedToken(TokenKind.While, TokenKind.For)
        ]);
        expect(file.ast.findChild(isContinueStatement)).to.exist;
    });

    it('detects `continue` used outside of a loop', () => {
        program.setFile<BrsFile>('source/main.bs', `
            sub main()
                continue for
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.illegalContinueStatement().message
        ]);
    });

    it('transpiles properly', () => {
        testTranspile(`
            sub main()
                while true
                    continue while
                end while
                for i = 0 to 10
                    continue for
                end for
            end sub
        `);
    });
});
