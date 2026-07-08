import { isBrsFile } from '../../astUtils/reflection';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { AfterValidateProgramEvent } from '../../interfaces';
import { RSG_VERSIONS } from '../../RokuConstants';
import util from '../../util';
import * as semver from 'semver';

export const ProgramValidatorDiagnosticsTag = 'ProgramValidator';

export class ProgramValidator {
    constructor(
        private event: AfterValidateProgramEvent
    ) { }

    public process() {
        this.flagScopelessBrsFiles();
        this.validateManifest();
    }

    /**
     * Flag any files that are included in 0 scopes.
     */
    private flagScopelessBrsFiles() {
        for (const key in this.event.program.files) {
            const file = this.event.program.files[key];

            if (
                //if this isn't a brs file, skip
                !isBrsFile(file) ||
                //if the file is included in at least one scope, skip
                this.event.program.getFirstScopeForFile(file)
            ) {
                continue;
            }

            this.event.program.diagnostics.register({
                ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                location: util.createLocationFromFileRange(file, util.createRange(0, 0, 0, Number.MAX_VALUE))
            }, { tags: [ProgramValidatorDiagnosticsTag] });
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
        const entries = this.event.program['getManifestEntries']();
        const manifestPath = this.event.program['getManifestPath']();
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
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.invalidRsgVersionFormat(value),
                location: util.createLocationFromRange(manifestPath, rsgEntry.range)
            }, { tags: [ProgramValidatorDiagnosticsTag] });
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
        const effectiveFw = this.event.program.getMinFirmwareVersion();

        //removal takes precedence over deprecation. If `removedAt <= effectiveFw`, fire the
        //removal error and skip the deprecation warning — the manifest entry is no longer honored.
        if (info.removedAt && semver.gte(effectiveFw, info.removedAt) && info.replacement) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.rsgVersionRemoved(value, info.removedAt, info.replacement),
                location: util.createLocationFromRange(manifestPath, rsgEntry.range)
            }, { tags: [ProgramValidatorDiagnosticsTag] });
        } else if (info.deprecatedAt && info.replacement && semver.gte(effectiveFw, info.deprecatedAt)) {
            //fire deprecation only when the effective firmware is >= the deprecation point — projects
            //targeting pre-deprecation firmware can legitimately keep using the old version.
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.rsgVersionDeprecated(value, info.replacement),
                location: util.createLocationFromRange(manifestPath, rsgEntry.range)
            }, { tags: [ProgramValidatorDiagnosticsTag] });
        }

        if (semver.lt(effectiveFw, info.introducedAt)) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.rsgVersionRequiresMinFirmware(value, info.introducedAt, effectiveFw),
                location: util.createLocationFromRange(manifestPath, rsgEntry.range)
            }, { tags: [ProgramValidatorDiagnosticsTag] });
        }
    }
}
