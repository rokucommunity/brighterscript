/**
 * Standalone formatting helpers with no project dependencies. This module must stay dependency-free
 * so that low-level modules (Logger, Stopwatch) can import it without creating circular imports.
 */

/**
 * Break a millisecond duration down into its time-unit parts. Mirrors the behavior of the `parse-ms` package
 * for the units we care about (minutes, seconds, milliseconds).
 */
export function parseMilliseconds(milliseconds: number) {
    const roundTowardsZero = milliseconds > 0 ? Math.floor : Math.ceil;
    return {
        days: roundTowardsZero(milliseconds / 86400000),
        hours: roundTowardsZero(milliseconds / 3600000) % 24,
        minutes: roundTowardsZero(milliseconds / 60000) % 60,
        seconds: roundTowardsZero(milliseconds / 1000) % 60,
        milliseconds: roundTowardsZero(milliseconds) % 1000
    };
}

/**
 * Format a `Date` as a 12-hour `hh:mm:ss:SSSS A` timestamp (e.g. `03:07:13:8460 PM`).
 * Replaces the single `moment().format('hh:mm:ss:SSSS A')` call previously used by the legacy Logger.
 */
export function formatTimestamp(date = new Date()) {
    const hours24 = date.getHours();
    const period = hours24 < 12 ? 'AM' : 'PM';
    let hours12 = hours24 % 12;
    if (hours12 === 0) {
        hours12 = 12;
    }
    const pad = (value: number, length: number) => value.toString().padStart(length, '0');
    return `${pad(hours12, 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}:${pad(date.getMilliseconds(), 3)}0 ${period}`;
}
