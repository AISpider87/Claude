/**
 * PostgREST caps responses at `max_rows` (1000 by default on Supabase). Domain
 * tables like `players` grow past that over the seasons (rows are never
 * deleted), so full-table reads must page through `.range()`.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

type RangeQuery<Row> = {
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>;
};

export async function fetchAll<Row>(makeQuery: () => RangeQuery<Row>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}
