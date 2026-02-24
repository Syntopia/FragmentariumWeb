const BUILD_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseBuildVersionString(versionString) {
  if (typeof versionString !== "string") {
    throw new Error("Build version must be a string.");
  }
  const trimmed = versionString.trim();
  const match = BUILD_VERSION_PATTERN.exec(trimmed);
  if (match === null) {
    throw new Error(`Invalid build version '${versionString}'. Expected format 'x.y.z'.`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  return { major, minor, patch };
}

export function formatBuildVersion({ major, minor, patch }) {
  if (![major, minor, patch].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error("Build version parts must be non-negative integers.");
  }
  return `${major}.${minor}.${patch}`;
}

export function incrementBuildVersionString(versionString) {
  const parsed = parseBuildVersionString(versionString);
  return formatBuildVersion({
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch + 1
  });
}
