/**
 * Response headers for the lists that barely change — stores, books, the
 * published form.
 *
 * `private` keeps them out of any shared proxy, and `Vary: Cookie` makes the
 * browser's own cache key include who asked: two managers may share a phone,
 * and every one of these responses is narrowed by RLS to the caller. Without
 * the Vary, signing in as someone else could show you the last person's
 * territory out of the disk cache.
 */
export const REF_CACHE = {
  'cache-control': 'private, max-age=60, stale-while-revalidate=600',
  vary: 'Cookie',
}
