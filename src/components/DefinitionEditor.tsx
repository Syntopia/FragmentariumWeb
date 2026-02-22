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

export function DefinitionEditor(props: DefinitionEditorProps): JSX.Element {
  const highlightRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  }, [highlighted]);

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
          }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            props.onBuild();
          }
        }}
      />
    </div>
  );
}
