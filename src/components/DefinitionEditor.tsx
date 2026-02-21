import { useMemo, useRef } from "react";
import { highlightDefinitionSource } from "./definitionSyntax";

interface DefinitionEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBuild: () => void;
}

export function DefinitionEditor(props: DefinitionEditorProps): JSX.Element {
  const highlightRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => highlightDefinitionSource(props.value), [props.value]);

  const syncScroll = (target: HTMLTextAreaElement): void => {
    if (highlightRef.current === null) {
      return;
    }
    highlightRef.current.scrollTop = target.scrollTop;
    highlightRef.current.scrollLeft = target.scrollLeft;
  };

  return (
    <div className="definition-editor">
      <pre className="source-editor definition-editor-highlight" ref={highlightRef} aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
      </pre>
      <textarea
        className="source-editor definition-editor-input"
        wrap="off"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        spellCheck={false}
        onScroll={(event) => syncScroll(event.currentTarget)}
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
