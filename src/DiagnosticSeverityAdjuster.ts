import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import type { BsConfig } from './BsConfig';
import type { BsDiagnostic } from './interfaces';

export class DiagnosticSeverityAdjuster {
    public adjust(options: BsConfig, diagnostics: BsDiagnostic[]): void {
        const map = this.createSeverityMap(options.severityOverride);

        diagnostics.forEach(diagnostic => {
            const code = String(diagnostic.code);
            if (map.has(code)) {
                diagnostic.severity = map.get(code);
            }
        });
    }

    public createSeverityMap(severityOverride: BsConfig['severityOverride']): Map<string, DiagnosticSeverity> {
        const map = new Map<string, DiagnosticSeverity>();
        Object.keys(severityOverride).forEach(key => {
            const value = severityOverride[key];
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
