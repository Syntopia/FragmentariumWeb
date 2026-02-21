interface Token {
  text: string;
  className?: string;
}

const KEYWORDS = new Set([
  "uniform",
  "const",
  "in",
  "out",
  "inout",
  "float",
  "int",
  "bool",
  "vec2",
  "vec3",
  "vec4",
  "mat2",
  "mat3",
  "mat4",
  "void",
  "return",
  "if",
  "else",
  "for",
  "while",
  "break",
  "continue",
  "true",
  "false"
]);

const FRAGMENTARIUM_WORDS = new Set([
  "slider",
  "checkbox",
  "color",
  "file",
  "Locked"
]);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function isNumberStart(source: string, index: number): boolean {
  const char = source[index];
  if (char >= "0" && char <= "9") {
    return true;
  }
  if (char === "." && index + 1 < source.length) {
    const next = source[index + 1];
    return next >= "0" && next <= "9";
  }
  return false;
}

function readNumber(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (
      (char >= "0" && char <= "9") ||
      char === "." ||
      char === "-" ||
      char === "+" ||
      char === "e" ||
      char === "E"
    ) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function readString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\"") {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function classifyIdentifier(word: string): string | undefined {
  if (KEYWORDS.has(word)) {
    return "def-token-keyword";
  }
  if (FRAGMENTARIUM_WORDS.has(word)) {
    return "def-token-control";
  }
  return undefined;
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function highlightLine(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < line.length) {
    const current = line[index];
    const next = index + 1 < line.length ? line[index + 1] : "";

    if (current === "/" && next === "/") {
      tokens.push({ text: line.slice(index), className: "def-token-comment" });
      break;
    }

    if (current === "\"") {
      const end = readString(line, index);
      tokens.push({ text: line.slice(index, end), className: "def-token-string" });
      index = end;
      continue;
    }

    if (current === "#") {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) {
        end += 1;
      }
      tokens.push({ text: line.slice(index, end), className: "def-token-directive" });
      index = end;
      continue;
    }

    if (isNumberStart(line, index)) {
      const end = readNumber(line, index);
      tokens.push({ text: line.slice(index, end), className: "def-token-number" });
      index = end;
      continue;
    }

    if (isIdentifierStart(current)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) {
        end += 1;
      }
      const word = line.slice(index, end);
      tokens.push({
        text: word,
        className: classifyIdentifier(word)
      });
      index = end;
      continue;
    }

    if ("(){}[]<>+-*/=!,.;:".includes(current)) {
      tokens.push({ text: current, className: "def-token-operator" });
      index += 1;
      continue;
    }

    tokens.push({ text: current });
    index += 1;
  }

  return tokens;
}

export function highlightDefinitionSource(source: string): string {
  return source
    .split("\n")
    .map((line) =>
      highlightLine(line)
        .map((token) => {
          const text = escapeHtml(token.text);
          if (token.className === undefined) {
            return text;
          }
          return `<span class="${token.className}">${text}</span>`;
        })
        .join("")
    )
    .join("\n");
}
