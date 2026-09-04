import { isBrsFile } from '../../astUtils/reflection';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { Program } from '../../Program';
import { RSG_VERSIONS } from '../../RokuConstants';
import util from '../../util';
import * as semver from 'semver';

export class ProgramValidator {
    constructor(private program: Program) { }

    public process() {
        this.flagScopelessBrsFiles();
        this.validateManifest();
    }

    /**
     * Flag any files that are included in 0 scopes.
     */
    private flagScopelessBrsFiles() {
        for (const key in this.program.files) {
            const file = this.program.files[key];

            if (
                //if this isn't a brs file, skip
                !isBrsFile(file) ||
                //if the file is included in at least one scope, skip
                this.program.getFirstScopeForFile(file)
            ) {
                continue;
            }

            this.program.addDiagnostics([{
                ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                file: file,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE)
            }]);
        }
    }

    /**
     * Validate the manifest's `rsg_version` entry. Lifecycle data is sourced from the
     * `RSG_VERSIONS` map in `src/RokuConstants.ts`; this validator simply derives diagnostics
     * from those fields:
     * - format must be parseable as semver
     * - cross-check `introducedAt` against effective `minFirmwareVersion`
     * - flag versions with a `deprecatedAt` availability field (e.g. 1.0)
     * Versions not in the map are treated as "unknown but valid" — no diagnostic.
     */
    private validateManifest() {
        //getManifestEntries and getManifestPath are intentionally protected for now (no stable
        //public API yet) — use bracket access here to bypass the visibility check.
        /* eslint-disable @typescript-eslint/dot-notation */
        const entries = this.program['getManifestEntries']();
        const manifestPath = this.program['getManifestPath']();
        /* eslint-enable @typescript-eslint/dot-notation */
        if (!entries || entries.length === 0 || !manifestPath) {
            return;
        }
        const rsgEntry = entries.find(e => e.key.trim() === 'rsg_version');
        if (!rsgEntry) {
            return;
        }
        const value = rsgEntry.value.trim();
        if (!semver.coerce(value)) {
            this.program.addDiagnostics([{
                ...DiagnosticMessages.invalidRsgVersionFormat(value),
                file: { srcPath: manifestPath, pkgPath: 'manifest' } as any,
                range: rsgEntry.range
            }]);
            return;
        }

        const info = RSG_VERSIONS[value];
        if (!info) {
            //version is parseable as semver but not in our known map — trust the user;
            //we don't have firmware-compat data for it.
            return;
        }

        //getMinFirmwareVersion returns canonical coerced semver; constants in RSG_VERSIONS are
        //hand-written valid semver. No re-coercion needed at this site.
        const effectiveFw = this.program.getMinFirmwareVersion();

        //removal takes precedence over deprecation. If `removedAt <= effectiveFw`, fire the
        //removal error and skip the deprecation warning — the manifest entry is no longer honored.
        if (info.removedAt && semver.gte(effectiveFw, info.removedAt) && info.replacement) {
            this.program.addDiagnostics([{
                ...DiagnosticMessages.rsgVersionRemoved(value, info.removedAt, info.replacement),
                file: { srcPath: manifestPath, pkgPath: 'manifest' } as any,
                range: rsgEntry.range
            }]);
        } else if (info.deprecatedAt && info.replacement && semver.gte(effectiveFw, info.deprecatedAt)) {
            //fire deprecation only when the effective firmware is >= the deprecation point — projects
            //targeting pre-deprecation firmware can legitimately keep using the old version.
            this.program.addDiagnostics([{
                ...DiagnosticMessages.rsgVersionDeprecated(value, info.replacement),
                file: { srcPath: manifestPath, pkgPath: 'manifest' } as any,
                range: rsgEntry.range
            }]);
        }

        if (semver.lt(effectiveFw, info.introducedAt)) {
            this.program.addDiagnostics([{
                ...DiagnosticMessages.rsgVersionRequiresMinFirmware(value, info.introducedAt, effectiveFw),
                file: { srcPath: manifestPath, pkgPath: 'manifest' } as any,
                range: rsgEntry.range
            }]);
        }
    }
}
