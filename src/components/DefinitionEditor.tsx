import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { highlightDefinitionSource } from "./definitionSyntax";

interface DefinitionEditorJumpRequest {
  line: number;
  token: number;
}

interface DefinitionEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBuild: () => void;
  jumpRequest?: DefinitionEditorJumpRequest | null;
  wrapLines?: boolean;
}

const INDENT_TOKEN = "  ";
interface SelectionRange {
  start: number;
  end: number;
}

interface LineNumberRow {
  key: string;
  label: string;
  sourceLine: number;
  isFirstVisualRow: boolean;
}

function resolveLineForOffset(value: string, offsetRaw: number): number {
  const offset = Math.max(0, Math.min(value.length, offsetRaw));
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (value.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return Math.max(1, line);
}

function numberArrayEquals(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function DefinitionEditor(props: DefinitionEditorProps): JSX.Element {
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersGutterRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<SelectionRange | null>(null);
  const [caretOffset, setCaretOffset] = useState(0);
  const [visualRowsByLine, setVisualRowsByLine] = useState<number[]>([]);
  const highlighted = useMemo(() => highlightDefinitionSource(props.value), [props.value]);
  const lines = useMemo(() => props.value.split(/\r\n|\r|\n/), [props.value]);
  const lineCount = Math.max(1, lines.length);
  const wrapLines = props.wrapLines ?? false;
  const gutterDigits = Math.max(2, String(lineCount).length);
  const activeLine = useMemo(
    () => Math.min(lineCount, resolveLineForOffset(props.value, caretOffset)),
    [caretOffset, lineCount, props.value]
  );
  const lineNumberRows = useMemo(() => {
    const rows: LineNumberRow[] = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const sourceLine = lineIndex + 1;
      const visualRows = Math.max(1, visualRowsByLine[lineIndex] ?? 1);
      rows.push({
        key: `${sourceLine}:0`,
        label: String(sourceLine),
        sourceLine,
        isFirstVisualRow: true
      });
      for (let visualIndex = 1; visualIndex < visualRows; visualIndex += 1) {
        rows.push({
          key: `${sourceLine}:${visualIndex}`,
          label: "",
          sourceLine,
          isFirstVisualRow: false
        });
      }
    }
    return rows;
  }, [lineCount, visualRowsByLine]);
  const editorStyle = useMemo(
    () =>
      ({
        "--editor-gutter-width": `calc(${gutterDigits}ch + 18px)`
      }) as CSSProperties,
    [gutterDigits]
  );

  const syncScroll = (target: HTMLTextAreaElement): void => {
    if (highlightRef.current === null) {
      return;
    }
    highlightRef.current.scrollTop = target.scrollTop;
    highlightRef.current.scrollLeft = target.scrollLeft;
    if (lineNumbersGutterRef.current !== null) {
      lineNumbersGutterRef.current.scrollTop = target.scrollTop;
    }
  };

  const syncCaretFromInput = (target: HTMLTextAreaElement): void => {
    setCaretOffset(target.selectionStart);
  };

  const syncFromInputRef = (): void => {
    const textarea = inputRef.current;
    if (textarea === null) {
      return;
    }
    syncScroll(textarea);
    syncCaretFromInput(textarea);
  };

  useEffect(() => {
    if (!wrapLines) {
      setVisualRowsByLine((prev) => {
        const next = Array.from({ length: lineCount }, () => 1);
        return numberArrayEquals(prev, next) ? prev : next;
      });
      return;
    }
    const textarea = inputRef.current;
    if (textarea === null) {
      return;
    }

    const recalcVisualRows = (): void => {
      const computed = window.getComputedStyle(textarea);
      const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
      const availablePx = textarea.clientWidth - paddingLeft - paddingRight;
      if (!Number.isFinite(availablePx) || availablePx <= 0) {
        return;
      }
      const lineHeightPx = Number.parseFloat(computed.lineHeight);
      if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
        return;
      }

      const measureNode = document.createElement("div");
      measureNode.style.position = "absolute";
      measureNode.style.visibility = "hidden";
      measureNode.style.pointerEvents = "none";
      measureNode.style.left = "-100000px";
      measureNode.style.top = "0";
      measureNode.style.width = `${availablePx}px`;
      measureNode.style.whiteSpace = "pre-wrap";
      measureNode.style.overflowWrap = "anywhere";
      measureNode.style.wordBreak = "break-word";
      measureNode.style.font = computed.font;
      measureNode.style.fontSize = computed.fontSize;
      measureNode.style.fontFamily = computed.fontFamily;
      measureNode.style.fontWeight = computed.fontWeight;
      measureNode.style.fontStyle = computed.fontStyle;
      measureNode.style.lineHeight = computed.lineHeight;
      measureNode.style.letterSpacing = computed.letterSpacing;
      measureNode.style.tabSize = computed.tabSize;
      measureNode.style.padding = "0";
      measureNode.style.border = "0";
      document.body.appendChild(measureNode);
      try {
        const nextRows = lines.map((line) => {
          measureNode.textContent = line.length === 0 ? " " : line;
          const measuredHeight = measureNode.scrollHeight;
          return Math.max(1, Math.round(measuredHeight / lineHeightPx));
        });
        setVisualRowsByLine((prev) => (numberArrayEquals(prev, nextRows) ? prev : nextRows));
      } finally {
        measureNode.remove();
      }
    };

    recalcVisualRows();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => recalcVisualRows());
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [lineCount, lines, wrapLines]);

  useLayoutEffect(() => {
    syncFromInputRef();
    const textarea = inputRef.current;
    const pendingSelection = pendingSelectionRef.current;
    if (textarea !== null && pendingSelection !== null) {
      const max = textarea.value.length;
      const start = Math.max(0, Math.min(max, pendingSelection.start));
      const end = Math.max(0, Math.min(max, pendingSelection.end));
      textarea.setSelectionRange(start, end);
      setCaretOffset(end);
      pendingSelectionRef.current = null;
    }
  }, [highlighted]);

  const applyEditorMutation = (
    textarea: HTMLTextAreaElement,
    nextValue: string,
    nextSelection: SelectionRange
  ): void => {
    pendingSelectionRef.current = nextSelection;
    setCaretOffset(nextSelection.end);
    props.onChange(nextValue);
    syncScroll(textarea);
  };

  const onIndentSelection = (textarea: HTMLTextAreaElement): void => {
    const source = props.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;

    if (selectionStart === selectionEnd) {
      const next = `${source.slice(0, selectionStart)}${INDENT_TOKEN}${source.slice(selectionEnd)}`;
      applyEditorMutation(textarea, next, {
        start: selectionStart + INDENT_TOKEN.length,
        end: selectionStart + INDENT_TOKEN.length
      });
      return;
    }

    const firstLineStart = source.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const before = source.slice(0, firstLineStart);
    const selected = source.slice(firstLineStart, selectionEnd);
    const after = source.slice(selectionEnd);
    const selectedLines = selected.split("\n");
    const indentedLines = selectedLines.map((line) => `${INDENT_TOKEN}${line}`);
    const nextSelected = indentedLines.join("\n");
    const next = `${before}${nextSelected}${after}`;

    applyEditorMutation(textarea, next, {
      start: selectionStart + INDENT_TOKEN.length,
      end: selectionEnd + INDENT_TOKEN.length * selectedLines.length
    });
  };

  const onOutdentSelection = (textarea: HTMLTextAreaElement): void => {
    const source = props.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const firstLineStart = source.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const before = source.slice(0, firstLineStart);
    const selected = source.slice(firstLineStart, selectionEnd);
    const after = source.slice(selectionEnd);
    const selectedLines = selected.split("\n");

    const removedCounts: number[] = [];
    const outdentedLines = selectedLines.map((line) => {
      if (line.startsWith(INDENT_TOKEN)) {
        removedCounts.push(INDENT_TOKEN.length);
        return line.slice(INDENT_TOKEN.length);
      }
      if (line.startsWith("\t")) {
        removedCounts.push(1);
        return line.slice(1);
      }
      removedCounts.push(0);
      return line;
    });

    const removedTotal = removedCounts.reduce((acc, value) => acc + value, 0);
    const removedFirst = removedCounts[0] ?? 0;
    const nextSelected = outdentedLines.join("\n");
    const next = `${before}${nextSelected}${after}`;
    const nextStart = Math.max(firstLineStart, selectionStart - removedFirst);
    const nextEnd = Math.max(nextStart, selectionEnd - removedTotal);

    applyEditorMutation(textarea, next, {
      start: nextStart,
      end: nextEnd
    });
  };

  useEffect(() => {
    const request = props.jumpRequest;
    const textarea = inputRef.current;
    if (request === undefined || request === null || textarea === null) {
      return;
    }
    const targetLine = Math.max(1, Math.floor(request.line));
    const clampedLine = Math.min(targetLine, lineCount);

    let offset = 0;
    for (let i = 0; i < clampedLine - 1; i += 1) {
      offset += lines[i].length + 1;
    }
    const lineLength = lines[clampedLine - 1]?.length ?? 0;

    textarea.focus();
    textarea.setSelectionRange(offset, offset + lineLength);
    setCaretOffset(offset);

    const computed = window.getComputedStyle(textarea);
    const lineHeightPx = Number.parseFloat(computed.lineHeight);
    if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
      const targetTop = (clampedLine - 1) * lineHeightPx;
      textarea.scrollTop = Math.max(0, targetTop - textarea.clientHeight * 0.4);
      syncScroll(textarea);
    }
  }, [lineCount, lines, props.jumpRequest]);

  return (
    <div className="definition-editor" style={editorStyle}>
      <div className="definition-editor-gutter" ref={lineNumbersGutterRef} aria-hidden="true">
        <pre className="source-editor definition-editor-line-numbers">
          {lineNumberRows.map((row) => (
            <span
              key={row.key}
              className={`definition-editor-line-number${row.isFirstVisualRow && row.sourceLine === activeLine ? " is-active" : ""}`}
            >
              {row.label}
            </span>
          ))}
        </pre>
      </div>
      <pre
        className={`source-editor definition-editor-highlight${wrapLines ? " is-wrap-enabled" : ""}`}
        ref={highlightRef}
        aria-hidden="true"
      >
        <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
      </pre>
      <textarea
        ref={inputRef}
        className={`source-editor definition-editor-input${wrapLines ? " is-wrap-enabled" : ""}`}
        wrap={wrapLines ? "soft" : "off"}
        value={props.value}
        onChange={(event) => {
          syncScroll(event.currentTarget);
          syncCaretFromInput(event.currentTarget);
          props.onChange(event.target.value);
        }}
        spellCheck={false}
        onScroll={(event) => syncScroll(event.currentTarget)}
        onSelect={(event) => {
          syncScroll(event.currentTarget);
          syncCaretFromInput(event.currentTarget);
        }}
        onClick={(event) => {
          syncScroll(event.currentTarget);
          syncCaretFromInput(event.currentTarget);
        }}
        onKeyUp={(event) => {
          syncScroll(event.currentTarget);
          syncCaretFromInput(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "F5") {
            event.preventDefault();
            props.onBuild();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            props.onBuild();
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            const textarea = event.currentTarget;
            if (event.shiftKey) {
              onOutdentSelection(textarea);
              return;
            }
            onIndentSelection(textarea);
          }
        }}
      />
    </div>
  );
}
