import { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import { expect } from 'chai';
import type { BrsFile } from '../../../files/BrsFile';

describe('ComponentStatement', () => {
    const rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;

    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('supports identifier-style component names', () => {
        program.setFile(`components/MyButton.bs`, `
            component MyButton extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports string component names', () => {
        program.setFile(`components/my-button.bs`, `
            component "my-button" extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports string parent name', () => {
        program.setFile(`components/my-button.bs`, `
            component "my-button" extends "button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports multiple components in a file', () => {
        const file = program.setFile<BrsFile>(`components/my-button.bs`, `
            component Button1 extends "Button"
            end component

            component Button2 extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
        expect(
            file.parser.references.componentStatements.map(x => x.name)
        ).to.eql([
            'Button1',
            'Button2'
        ]);
    });

    it('catches weird component names, and recovers for next component in the file', () => {
        const file = program.setFile<BrsFile>(`components/my-button.bs`, `
            component Bogus.Name extends "Button"
            end component

            component ValidName extends "Button"
            end component
        `);
        expect(
            file.parser.references.componentStatements.map(x => x.name)
        ).to.include(
            'ValidName'
        );
    });
});
