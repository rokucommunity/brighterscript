import { expect } from '../../../chai-config.spec';
import { createSandbox } from 'sinon';
import { isContinueStatement } from '../../../astUtils/reflection';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TokenKind } from '../../../lexer/TokenKind';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { rootDir } from '../../../testHelpers.spec';
import type { BrsFile } from '../../../files/BrsFile';
import { BrsTranspileState } from '../../BrsTranspileState';
import { SourceNode } from 'source-map';
const sinon = createSandbox();

describe('parser continue statements', () => {
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

    it('allows `continue` to be used as a local variable', () => {
        program.setFile<BrsFile>('source/main.bs', `
            sub main()
                continue = true
                print continue
                if not continue then
                    print continue
                end if
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('transpiles properly', async () => {
        await testTranspile(`
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

    describe('rewrites continue as goto for older firmware', () => {
        it('rewrites `continue for` into a goto label', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main()
                    for i = 0 to 10
                        continue for
                    end for
                end sub
            `, `
                sub main()
                    for i = 0 to 10
                        goto BRIGHTERSCRIPT_CONTINUE_0
                        BRIGHTERSCRIPT_CONTINUE_0:
                    end for
                end sub
            `);
        });

        it('rewrites `continue while` into a goto label', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main()
                    while true
                        continue while
                    end while
                end sub
            `, `
                sub main()
                    while true
                        goto BRIGHTERSCRIPT_CONTINUE_0
                        BRIGHTERSCRIPT_CONTINUE_0:
                    end while
                end sub
            `);
        });

        it('rewrites `continue for` inside a for-each loop', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main()
                    for each item in [1, 2, 3]
                        continue for
                    end for
                end sub
            `, `
                sub main()
                    for each item in [
                        1
                        2
                        3
                    ]
                        goto BRIGHTERSCRIPT_CONTINUE_0
                        BRIGHTERSCRIPT_CONTINUE_0:
                    end for
                end sub
            `);
        });

        it('uses a distinct label per loop and targets the innermost loop', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main()
                    for i = 0 to 10
                        for j = 0 to 10
                            continue for
                        end for
                        continue for
                    end for
                end sub
            `, `
                sub main()
                    for i = 0 to 10
                        for j = 0 to 10
                            goto BRIGHTERSCRIPT_CONTINUE_1
                            BRIGHTERSCRIPT_CONTINUE_1:
                        end for
                        goto BRIGHTERSCRIPT_CONTINUE_0
                        BRIGHTERSCRIPT_CONTINUE_0:
                    end for
                end sub
            `);
        });

        it('does not emit a label for loops that contain no continue statement', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main()
                    for i = 0 to 10
                        print i
                    end for
                end sub
            `);
        });

        it('emits `continue` natively when targeting 11.5.0 or higher', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.5.0' });
            await testTranspile(`
                sub main()
                    for i = 0 to 10
                        continue for
                    end for
                end sub
            `);
        });
    });

    it('emits `continue` as-is when the transpile state predates the loop-label api', () => {
        //simulates a plugin bundling a newer brighterscript than the host: the AST nodes are new
        //but the BrsTranspileState comes from the older host, so it has none of the loop-label api
        program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                for i = 0 to 10
                    continue for
                end for
            end sub
        `);
        const state = new BrsTranspileState(file);
        //strip the newer api from this instance only (the host's state would never have had it)
        const legacyState = Object.create(state);
        for (let name of ['firmwareCapabilities', 'pushLoopLabel', 'popLoopLabel', 'peekLoopLabel', 'getLoopLabel']) {
            legacyState[name] = undefined;
        }
        expect(
            new SourceNode(null, null, null, file.ast.transpile(legacyState) as any).toString()
        ).to.include('continue for');
    });

    it('does not crash when missing loop type', () => {
        program.plugins['suppressErrors'] = false;
        program.setFile('source/main.brs', `
            sub main()
                while true
                    continue
                end while
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.expectedToken(TokenKind.While, TokenKind.For).message
        ]);
    });
});
