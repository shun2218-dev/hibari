/** メンバー・招待の一覧の 1 ページの数。API の上限（ADR 0011）にして、往復を減らす。 */
export const PAGE_SIZE = 200;

/** カーソル（ADR 0011）をたどって全件を集める。 */
export async function listAll<T, P extends { next_cursor: string | null }>(
  fetchPage: (params: URLSearchParams) => Promise<P>,
  itemsOf: (page: P) => T[],
): Promise<T[]> {
  const items: T[] = [];
  let after: string | null = null;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const page = await fetchPage(params);
    items.push(...itemsOf(page));
    after = page.next_cursor;
  } while (after);
  return items;
}
