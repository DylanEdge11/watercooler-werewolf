/** Every object key anywhere inside a JSON-like value, for checking that a response leaks none of the forbidden player keys. */
export function keysOf(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      keysOf(child, keys);
    }
  }
  return keys;
}
