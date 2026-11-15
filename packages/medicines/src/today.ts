/**
 * "Today" for the warning engine and synthetic data. TOMONI_TODAY pins it (tests, e2e, demos).
 * ponytail: UTC date; per-practice time zones matter only near midnight, revisit if that bites.
 */
export const today = (): string => process.env.TOMONI_TODAY ?? new Date().toISOString().slice(0, 10);
