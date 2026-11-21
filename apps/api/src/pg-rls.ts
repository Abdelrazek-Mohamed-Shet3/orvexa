/**
 * PostgreSQL Row-Level Security (RLS) Multi-Tenant Session Helper (Spec §14.9).
 * Sets `app.current_org_id` locally inside every database transaction so Postgres
 * itself enforces tenant isolation on all 11 organization-scoped tables.
 */
export interface SqlExecutor {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export async function withTenantRlsTransaction<T>(
  pool: { connect: () => Promise<SqlExecutor & { release: () => void }> },
  organizationId: string,
  fn: (client: SqlExecutor) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
