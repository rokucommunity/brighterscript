/**
 * Best-effort validation of a SceneGraph field value written as an xml attribute string.
 *
 * Intentionally conservative: only unambiguous scalar types are checked. Anything ambiguous (strings,
 * nodes, uris, arrays, vectors, enums/option-strings, unknown types, etc.) passes, so we never emit a
 * false positive for the many field types whose valid literal form is hard to pin down from xml alone.
 *
 * @param value the (unquoted) attribute value
 * @param type the field's declared type (e.g. `integer`, `float`, `boolean`, `color`, `option string`)
 * @returns true when the value is valid for the type, or when the type isn't one we confidently validate
 */
export function isValidSceneGraphFieldValue(value: string, type: string): boolean {
    const validator = scalarValidators[normalizeFieldType(type)];
    //no validator for this type -> assume valid
    return validator ? validator(value ?? '') : true;
}

function normalizeFieldType(type: string): string {
    let normalized = (type ?? '').trim().toLowerCase();
    //"option string", "value string", etc. are all just strings
    if (normalized.endsWith(' string')) {
        normalized = 'string';
    }
    return normalized;
}

const integerPattern = /^[+-]?\d+$/;
const floatPattern = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const booleanPattern = /^(true|false)$/i;
const colorPattern = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|0x[0-9a-f]{6}|0x[0-9a-f]{8})$/i;

const scalarValidators: Record<string, (value: string) => boolean> = {
    integer: value => integerPattern.test(value),
    int: value => integerPattern.test(value),
    longinteger: value => integerPattern.test(value),
    float: value => floatPattern.test(value),
    double: value => floatPattern.test(value),
    time: value => floatPattern.test(value),
    boolean: value => booleanPattern.test(value),
    bool: value => booleanPattern.test(value),
    color: value => colorPattern.test(value)
};
