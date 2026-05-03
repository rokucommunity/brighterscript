/**
 * Lifecycle metadata for a single `rsg_version` value.
 *
 * Sources: Roku's developer release notes and channel-manifest documentation. When adding a new
 * rsg_version, record the firmware versions at each lifecycle transition rather than scattering
 * version numbers across the codebase.
 */
export interface RsgVersionInfo {
    /**
     * Minimum Roku firmware version that can compile/run this rsg_version. If `effectiveFw <
     * introducedAt` and the manifest declares this version, the project is misconfigured.
     */
    introducedAt: string;

    /**
     * Firmware version where this rsg_version becomes the expected default for new development
     * at that firmware target. For older versions (1.0/1.1/1.2) this corresponds to Roku's
     * device-side silent fallback (what runs when the manifest is silent). For 1.3 it
     * corresponds to Roku's static-analysis cert requirement (the firmware at which the cert
     * tool flags channels for not declaring 1.3). `getRsgVersion()` walks this field
     * (highest matching wins) to figure out what version a project should target.
     */
    becameDefaultAt?: string;

    /**
     * Firmware version that deprecated this rsg_version. Channels using a deprecated version
     * still function with the semantics they declared but are flagged for upgrade.
     */
    deprecatedAt?: string;

    /**
     * Firmware version where this rsg_version stopped being honored as declared. From this
     * firmware on, the device either refuses to run the channel or silently substitutes a
     * different rsg_version (`replacement`). Either way, the manifest entry no longer means
     * what the developer wrote, so this is treated as an error-severity diagnostic.
     */
    removedAt?: string;

    /**
     * Suggested replacement value. Used both for the deprecation suggestion and (when set
     * together with `removedAt`) to describe what the device silently runs instead.
     */
    replacement?: string;
}

/**
 * Single source of truth for known `rsg_version` values. Adding a new RSG version means adding
 * one entry here; downstream validators and `Program.getRsgVersion()` will pick it up.
 *
 * Versions not present in this map are treated as "unknown but valid" (assuming they parse as
 * semver). brighterscript can't validate firmware compatibility for versions it hasn't been
 * updated to recognize.
 */
export const RSG_VERSIONS: Record<string, RsgVersionInfo> = {
    '1.0': {
        introducedAt: '0.0.0', // launched with Roku SceneGraph itself (Oct 2015); pre-dates the 1.1 flag
        becameDefaultAt: '0.0.0', // was the default until Roku OS 7.5 introduced 1.1 as the new default
        deprecatedAt: '8.0.0', // Roku OS 8 deprecated rsg_version=1.0
        removedAt: '9.0.0', // Roku OS 9 dropped support for rsg_version=1.0 entirely
        replacement: '1.2'
    },
    '1.1': {
        introducedAt: '7.5.0', // Roku OS 7.5 introduced rsg_version=1.1
        becameDefaultAt: '7.5.0', // also became the default in 7.5, replacing 1.0 as the silent default
        removedAt: '14.5.0', // Roku OS 14.5 silently treats rsg_version=1.1 as 1.2 — manifest entry no longer honored
        replacement: '1.2'
    },
    '1.2': {
        introducedAt: '9.0.0', // Roku OS 9.0 introduced rsg_version=1.2 as opt-in
        becameDefaultAt: '9.3.0', // Roku OS 9.3 made rsg_version=1.2 the manifest-silent default

        //Roku announced 1.2 as "being deprecated" alongside the OS 15.0 launch (Oct 2025), with a
        //2026-10-01 certification deadline. We gate the warning on 15.1.0 (the firmware where 1.3
        //became the required minimum for new app submissions) — a project targeting that firmware
        //or newer can actually adopt 1.3, so the warning is actionable.
        deprecatedAt: '15.1.0',
        replacement: '1.3'
    },
    '1.3': {
        introducedAt: '15.0.0', // Roku OS 15.0 made rsg_version=1.3 available (Oct 2025)
        becameDefaultAt: '15.1.0' // Roku's static analysis cert tool requires rsg_version=1.3
        //when the manifest's minFirmwareVersion is 15.1.0+ (warning today, blocks publishing
        //starting Oct 1, 2026). This is the firmware where 1.3 effectively becomes the
        //expected default for new development. TODO: confirm exact semantics with Roku.
    }
};

/**
 * Default minimum Roku firmware version assumed when the user hasn't configured
 * `minFirmwareVersion`. Chosen to reflect a modern Roku target so that diagnostics relevant to
 * current firmware fire by default. Users targeting older firmware should set
 * `minFirmwareVersion` explicitly.
 */
export const DEFAULT_MIN_FIRMWARE_VERSION = '15.0.0';

/**
 * Minimum Roku firmware version that introduced optional chaining (`?.`, `?[`, `?(`).
 * Optional chaining is NOT transpiled by BrighterScript, so this restriction applies to both
 * .brs and .bs files — the target device must natively support it.
 * Source: Roku OS 11 release notes.
 */
export const OPTIONAL_CHAINING_MIN_FIRMWARE_VERSION = '11.0.0';

/**
 * The rsg_version at which `eval()` becomes a compile error on device.
 * Source: Roku OS 9.0 release notes — `eval()` deprecated when rsg_version=1.2 is set;
 * sunset entirely in Roku OS 9.3.
 */
export const EVAL_REMOVED_AT_RSG_VERSION = '1.2.0';
