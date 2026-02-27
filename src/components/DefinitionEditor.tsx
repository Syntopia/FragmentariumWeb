import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
}

const INDENT_TOKEN = "  ";

interface SelectionRange {
  start: number;
  end: number;
}

export function DefinitionEditor(props: DefinitionEditorProps): JSX.Element {
  const highlightRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<SelectionRange | null>(null);
  const highlighted = useMemo(() => highlightDefinitionSource(props.value), [props.value]);

  const syncScroll = (target: HTMLTextAreaElement): void => {
    if (highlightRef.current === null) {
      return;
    }
    highlightRef.current.scrollTop = target.scrollTop;
    highlightRef.current.scrollLeft = target.scrollLeft;
  };

  const syncFromInputRef = (): void => {
    const textarea = inputRef.current;
    if (textarea === null) {
      return;
    }
    syncScroll(textarea);
  };

  useLayoutEffect(() => {
    syncFromInputRef();
    const textarea = inputRef.current;
    const pendingSelection = pendingSelectionRef.current;
    if (textarea !== null && pendingSelection !== null) {
      const max = textarea.value.length;
      const start = Math.max(0, Math.min(max, pendingSelection.start));
      const end = Math.max(0, Math.min(max, pendingSelection.end));
      textarea.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
    }
  }, [highlighted]);

  const applyEditorMutation = (
    textarea: HTMLTextAreaElement,
    nextValue: string,
    nextSelection: SelectionRange
  ): void => {
    pendingSelectionRef.current = nextSelection;
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
    const lines = selected.split("\n");
    const indentedLines = lines.map((line) => `${INDENT_TOKEN}${line}`);
    const nextSelected = indentedLines.join("\n");
    const next = `${before}${nextSelected}${after}`;

    applyEditorMutation(textarea, next, {
      start: selectionStart + INDENT_TOKEN.length,
      end: selectionEnd + INDENT_TOKEN.length * lines.length
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
    const lines = selected.split("\n");

    const removedCounts: number[] = [];
    const outdentedLines = lines.map((line) => {
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
    const lines = props.value.split(/\r\n|\r|\n/);
    const clampedLine = Math.min(targetLine, Math.max(lines.length, 1));

    let offset = 0;
    for (let i = 0; i < clampedLine - 1; i += 1) {
      offset += lines[i].length + 1;
    }
    const lineLength = lines[clampedLine - 1]?.length ?? 0;

    textarea.focus();
    textarea.setSelectionRange(offset, offset + lineLength);

    const computed = window.getComputedStyle(textarea);
    const lineHeightPx = Number.parseFloat(computed.lineHeight);
    if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
      const targetTop = (clampedLine - 1) * lineHeightPx;
      textarea.scrollTop = Math.max(0, targetTop - textarea.clientHeight * 0.4);
      syncScroll(textarea);
    }
  }, [props.jumpRequest, props.value]);

  return (
    <div className="definition-editor">
      <pre className="source-editor definition-editor-highlight" ref={highlightRef} aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
      </pre>
      <textarea
        ref={inputRef}
        className="source-editor definition-editor-input"
        wrap="off"
        value={props.value}
        onChange={(event) => {
          syncScroll(event.currentTarget);
          props.onChange(event.target.value);
        }}
        spellCheck={false}
        onScroll={(event) => syncScroll(event.currentTarget)}
        onSelect={(event) => syncScroll(event.currentTarget)}
        onClick={(event) => syncScroll(event.currentTarget)}
        onKeyUp={(event) => syncScroll(event.currentTarget)}
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
