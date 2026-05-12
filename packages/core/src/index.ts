export const VERSION = '0.1.0';

export * from './errors.js';
export * from './pbir/schemas.js';
export * from './pbir/io.js';
export * from './pbir/path.js';
export * from './pbir/validators.js';
export * from './report/scaffold.js';
export * from './report/info.js';
export * from './report/pages.js';
export * from './visual/backend.js';
export * from './visual/roles.js';
export {
  fillTemplate,
  loadTemplateRaw,
  type TemplatePlaceholders,
} from './visual/templates.js';
