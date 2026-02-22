const INDENT = "  ";

export interface FormatFragmentSourceResult {
  text: string;
  changed: boolean;
}

export function normalizeFragmentNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

interface StripCommentsResult {
  code: string;
  inBlockComment: boolean;
}

function stripCommentsForBraces(line: string, inBlockComment: boolean): StripCommentsResult {
  let index = 0;
  let inString: "'" | '"' | null = null;
  let escape = false;
  const out: string[] = [];

  while (index < line.length) {
    const ch = line[index];
    const next = index + 1 < line.length ? line[index + 1] : "";

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (inString !== null) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      }
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = ch;
      index += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      break;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }

    out.push(ch);
    index += 1;
  }

  return {
    code: out.join(""),
    inBlockComment
  };
}

interface LineBraceStats {
  delta: number;
  leadingClose: number;
  inBlockComment: boolean;
}

function lineBraceStats(line: string, inBlockComment: boolean): LineBraceStats {
  const stripped = stripCommentsForBraces(line, inBlockComment);
  const leftTrimmed = stripped.code.trimStart();
  let leadingClose = 0;
  for (const ch of leftTrimmed) {
    if (ch === "}") {
      leadingClose += 1;
      continue;
    }
    break;
  }

  let delta = 0;
  for (const ch of stripped.code) {
    if (ch === "{") {
      delta += 1;
    } else if (ch === "}") {
      delta -= 1;
    }
  }

  return {
    delta,
    leadingClose,
    inBlockComment: stripped.inBlockComment
  };
}

function collapseBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  let lastBlank = true;
  for (const line of lines) {
    if (line === "") {
      if (lastBlank) {
        continue;
      }
      out.push("");
      lastBlank = true;
      continue;
    }
    out.push(line);
    lastBlank = false;
  }

  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  return out;
}

export function formatFragmentSourceText(text: string): string {
  const normalized = normalizeFragmentNewlines(text);
  const lines = normalized.split("\n");

  const out: string[] = [];
  let indentLevel = 0;
  let inPreset = false;
  let inBlockComment = false;

  for (const original of lines) {
    const line = original.replace(/[ \t]+$/g, "");
    const stripped = line.trim();

    if (stripped === "") {
      out.push("");
      continue;
    }

    const lower = stripped.toLowerCase();
    const isDirective = stripped.startsWith("#");

    if (isDirective) {
      out.push(stripped);
      if (lower.startsWith("#preset ")) {
        inPreset = true;
      } else if (lower === "#endpreset") {
        inPreset = false;
      }
      continue;
    }

    if (inPreset) {
      out.push(line.trimStart());
      continue;
    }

    const stats = lineBraceStats(line, inBlockComment);
    inBlockComment = stats.inBlockComment;
    const effectiveIndent = Math.max(indentLevel - stats.leadingClose, 0);
    out.push(`${INDENT.repeat(effectiveIndent)}${line.trimStart()}`);
    indentLevel = Math.max(indentLevel + stats.delta, 0);
  }

  return `${collapseBlankLines(out).join("\n")}\n`;
}

export function formatFragmentSource(text: string): FormatFragmentSourceResult {
  const normalized = normalizeFragmentNewlines(text);
  const formatted = formatFragmentSourceText(text);
  return {
    text: formatted,
    changed: formatted !== normalized
  };
}
