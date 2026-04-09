/** schema.layout.json — persisted canvas positions keyed by SQL table name */

export const SCHEMA_LAYOUT_FILENAME = 'schema.layout.json';

export interface SchemaLayoutFile {
  version: 1;
  tables: Record<string, { x: number; y: number }>;
}

export function createEmptySchemaLayout(): SchemaLayoutFile {
  return { version: 1, tables: {} };
}

export function stringifySchemaLayout(layout: SchemaLayoutFile): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

export function parseSchemaLayout(json: string): SchemaLayoutFile | null {
  try {
    const data = JSON.parse(json) as unknown;
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    if (obj.version !== 1) return null;
    if (!obj.tables || typeof obj.tables !== 'object') return null;
    const tables: Record<string, { x: number; y: number }> = {};
    for (const [name, pos] of Object.entries(
      obj.tables as Record<string, unknown>,
    )) {
      if (!pos || typeof pos !== 'object') continue;
      const p = pos as Record<string, unknown>;
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        tables[name] = { x, y };
      }
    }
    return { version: 1, tables };
  } catch {
    return null;
  }
}

export function buildLayoutFromPositions(
  positions: Record<string, { x: number; y: number }>,
): SchemaLayoutFile {
  return { version: 1, tables: { ...positions } };
}
