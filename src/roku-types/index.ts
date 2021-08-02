// eslint-disable-next-line @typescript-eslint/no-require-imports
import data = require('./data.json');

//apply any transforms/overrides before exporting

export const nodes = data.nodes;
export const components = data.components;
export const interfaces = data.interfaces;
export const events = data.events;
