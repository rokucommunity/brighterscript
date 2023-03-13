import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import { expect } from './chai-config.spec';

import { DiagnosticSeverityAdjuster } from './DiagnosticSeverityAdjuster';
import type { BsDiagnostic } from './interfaces';

describe('DiagnosticSeverityAdjuster', () => {
    const adjuster = new DiagnosticSeverityAdjuster();

    it('supports empty map', () => {
        const actual = adjuster.createSeverityMap({});
        expect(Array.from(actual.keys()).length === 0);
    });

    it('maps strings to enums', () => {
        const actual = adjuster.createSeverityMap({
            'a': 'error',
            'b': 'warn',
            'c': 'info',
            1001: 'hint',
            // @ts-expect-error using invalid key
            'e': 'foo',
            // @ts-expect-error using invalid key
            'f': 42
        });
        expect(actual.get('a')).to.equal(DiagnosticSeverity.Error);
        expect(actual.get('b')).to.equal(DiagnosticSeverity.Warning);
        expect(actual.get('c')).to.equal(DiagnosticSeverity.Information);
        expect(actual.get('1001')).to.equal(DiagnosticSeverity.Hint);
        expect(actual.get('e')).to.equal(undefined);
        expect(actual.get('f')).to.equal(undefined);
    });

    it('adjusts severity', () => {
        const diagnostics = [
            {
                code: 'BSLINT1001',
                severity: DiagnosticSeverity.Error
            } as BsDiagnostic, {
                code: 1001,
                severity: DiagnosticSeverity.Error
            } as BsDiagnostic
        ];
        adjuster.adjust({
            diagnosticSeverityOverrides: {
                'BSLINT1001': 'warn',
                1001: 'info'
            }
        }, diagnostics);
        expect(diagnostics[0].severity).to.equal(DiagnosticSeverity.Warning);
        expect(diagnostics[1].severity).to.equal(DiagnosticSeverity.Information);
    });
});
