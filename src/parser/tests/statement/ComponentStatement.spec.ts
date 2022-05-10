import util, { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { expect } from 'chai';
import type { BrsFile } from '../../../files/BrsFile';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { createVisitor, WalkMode } from '../../../astUtils/visitors';
import * as sinon from 'sinon';

describe('ComponentStatement', () => {
    const rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;

    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('supports identifier-style component names', () => {
        program.setFile(`source/MyButton.bs`, `
            component MyButton extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports string component names', () => {
        program.setFile(`source/MyButton.bs`, `
            component "my-button" extends "Button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports string parent name', () => {
        program.setFile(`source/MyButton.bs`, `
            component "my-button" extends "button"
            end component
        `);
        expectZeroDiagnostics(program);
    });

    it('supports multiple components in a file', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
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
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
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

    it('mandates member access modifiers', () => {
        program.setFile<BrsFile>(`source/MyButton.bs`, `
            component MyButton extends "Button"
                name as string
                function getName()
                end function
            end component
        `);
        program.validate();
        expectDiagnostics(program, [
            {
                ...DiagnosticMessages.accessModifierIsRequired(),
                range: util.createRange(2, 16, 2, 20)
            },
            {
                ...DiagnosticMessages.accessModifierIsRequired(),
                range: util.createRange(3, 25, 3, 32)
            }
        ]);
    });

    it('is walkable', () => {
        const file = program.setFile<BrsFile>(`source/MyButton.bs`, `
            component MyButton extends "Button"
                name as string
                function getName()
                end function
            end component
        `);
        const componentSpy = sinon.spy();
        const fieldSpy = sinon.spy();
        const methodSpy = sinon.spy();
        file.ast.walk(createVisitor({
            ComponentStatement: componentSpy,
            FieldStatement: fieldSpy,
            MethodStatement: methodSpy
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
        expect(
            componentSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0]
        );
        expect(
            fieldSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0].body[0]
        );
        expect(
            methodSpy.getCalls()[0].args[0]
        ).to.equal(
            file.parser.references.componentStatements[0].body[1]
        );
    });
});
