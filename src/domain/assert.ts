/**
 * The end of an exhaustive `switch` over a union. It compiles only while every
 * member is handled, so adding a member turns each unhandled switch into a
 * type error rather than a silent fall-through.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
