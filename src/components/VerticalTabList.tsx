export interface VerticalTabItem {
  id: string;
  label: string;
  shortLabel?: string;
}

interface VerticalTabListProps {
  tabs: VerticalTabItem[];
  activeTabId: string;
  onChange: (tabId: string) => void;
}

export function VerticalTabList(props: VerticalTabListProps): JSX.Element {
  return (
    <div className="vertical-tabs" role="tablist" aria-orientation="vertical">
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.activeTabId === tab.id}
          className={`vertical-tab ${props.activeTabId === tab.id ? "is-active" : ""}`}
          onClick={() => props.onChange(tab.id)}
          title={tab.label}
        >
          <span className="vertical-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
