/**
 * Read-only handles for the end-to-end tests (e2e/). Only the dev server
 * exposes them: `import.meta.env.DEV` is false in a production build, so this
 * code and the handles are dropped there. Returns a function that removes the handle.
 */
export function exposeForTests(name: string, value: unknown): () => void {
  if (!import.meta.env.DEV) return () => {};
  const holder = window as unknown as { __piano?: Record<string, unknown> };
  const all = (holder.__piano ??= {});
  all[name] = value;
  return () => {
    if (all[name] === value) delete all[name];
  };
}
