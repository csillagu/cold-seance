// The Drizzle schema (DD-057): one module per part of the backend, under schema/. A backend block
// puts its tables in a module of its own and adds its line below, in alphabetical order. A module
// imports the tables it references from the modules that hold them, never from this file: its
// re-exports are not yet set while a module loads. The migration comes from `npm run db:generate`
// (SC-073).
export * from './schema/core.ts'
export * from './schema/red-flags.ts'
