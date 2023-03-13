import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import type { BsConfig } from './BsConfig';
import type { BsDiagnostic } from './interfaces';

export class DiagnosticSeverityAdjuster {
    public adjust(options: BsConfig, diagnostics: BsDiagnostic[]): void {
        const map = this.createSeverityMap(options.diagnosticSeverityOverrides);

        diagnostics.forEach(diagnostic => {
            const code = String(diagnostic.code);
            if (map.has(code)) {
                diagnostic.severity = map.get(code);
            }
        });
    }

    public createSeverityMap(diagnosticSeverityOverrides: BsConfig['diagnosticSeverityOverrides']): Map<string, DiagnosticSeverity> {
        const map = new Map<string, DiagnosticSeverity>();
        Object.keys(diagnosticSeverityOverrides).forEach(key => {
            const value = diagnosticSeverityOverrides[key];
            switch (value) {
                case 'error':
                    map.set(key, DiagnosticSeverity.Error);
                    break;
                case 'warn':
                    map.set(key, DiagnosticSeverity.Warning);
                    break;
                case 'info':
                    map.set(key, DiagnosticSeverity.Information);
                    break;
                case 'hint':
                    map.set(key, DiagnosticSeverity.Hint);
                    break;
            }
        });
        return map;
    }
}
