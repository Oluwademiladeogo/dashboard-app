import pool from "./db";

const columnCache = new Map<string, Set<string>>();

export async function getTableColumns(tableName: string): Promise<Set<string>> {
  if (columnCache.has(tableName)) {
    return columnCache.get(tableName)!;
  }

  const [rows] = await pool.query(`SHOW COLUMNS FROM ${tableName}`) as [Array<{ Field: string }>, unknown];
  const columns = new Set(rows.map((row) => row.Field));
  columnCache.set(tableName, columns);
  return columns;
}
