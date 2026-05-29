/** Run a Supabase `.in(column, ids)` query in chunks to avoid slow plans and URL limits. */
export async function queryInChunks<T, R>(
  ids: string[],
  chunkSize: number,
  run: (chunk: string[]) => Promise<T[]>,
  merge: (acc: R, batch: T[]) => R,
  initial: R
): Promise<R> {
  if (ids.length === 0) return initial;
  let acc = initial;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = await run(ids.slice(i, i + chunkSize));
    acc = merge(acc, batch);
  }
  return acc;
}
