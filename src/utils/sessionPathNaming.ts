export function makeSuffixedSessionPath(basePath: string, index: number): string {
  if (basePath.trim().length === 0) {
    throw new Error("Session path cannot be empty.");
  }
  if (!Number.isInteger(index) || index < 2) {
    throw new Error("Session suffix index must be an integer >= 2.");
  }
  return `${basePath} (${index})`;
}

export function makeUniqueSessionPath(basePath: string, occupiedPaths: Iterable<string>): string {
  if (basePath.trim().length === 0) {
    throw new Error("Session path cannot be empty.");
  }

  const occupied = new Set<string>(occupiedPaths);
  if (!occupied.has(basePath)) {
    return basePath;
  }

  for (let index = 2; index < 100000; index += 1) {
    const candidate = makeSuffixedSessionPath(basePath, index);
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not allocate a unique session path for '${basePath}'.`);
}
