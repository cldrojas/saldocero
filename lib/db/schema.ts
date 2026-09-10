// lib/db/schema.ts
// Single source of truth: the DDL lives in schema.sql (idempotent),
// re-exported here as a string so the client-side sql.js layer can apply it
// without fs access.
import schemaSql from './schema.sql?raw'

export const SCHEMA = schemaSql