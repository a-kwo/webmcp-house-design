import { DEFAULT_TEMPLATE_ID, buildTemplate } from './templates';

/**
 * The default design: the two-bedroom template, which every part of the app
 * and the test suite treats as the canonical fixture. Templates own the data;
 * this module is just the well-known name for the default one.
 */
export const sampleFloorplan = buildTemplate(DEFAULT_TEMPLATE_ID);
