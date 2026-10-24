import { useRef, type KeyboardEvent } from 'react';
import { EditorIcon, type EditorIconName } from './editor-icons';

export interface SidebarTabItem<T extends string> {
  disabled?: boolean;
  icon: EditorIconName;
  iconSize?: number;
  id: T;
  label: string;
  title?: string;
}

interface SidebarTabsProps<T extends string> {
  activeTab: T;
  ariaLabel: string;
  className?: string;
  items: readonly SidebarTabItem<T>[];
  onChange: (tab: T) => void;
  panelId: (tab: T) => string;
  tabId: (tab: T) => string;
}

export function SidebarTabs<T extends string>({
  activeTab,
  ariaLabel,
  className,
  items,
  onChange,
  panelId,
  tabId,
}: SidebarTabsProps<T>) {
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SidebarTabItem<T>) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === current.id);

    if (index === -1 || enabled.length === 0) {
      return;
    }

    let next: SidebarTabItem<T> | undefined;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = enabled[(index + 1) % enabled.length];
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }

    if (!next) {
      return;
    }

    event.preventDefault();
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <div aria-label={ariaLabel} aria-orientation="vertical" className={className} role="tablist">
      {items.map((item) => {
        const active = item.id === activeTab;

        return (
          <button
            aria-controls={item.disabled ? undefined : panelId(item.id)}
            aria-selected={active}
            className={
              active
                ? 'cr-nav-item cr-nav-item--active'
                : item.disabled
                  ? 'cr-nav-item'
                  : 'cr-nav-item cr-nav-item--link'
            }
            disabled={item.disabled}
            id={tabId(item.id)}
            key={item.id}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, item)}
            ref={(node) => {
              if (node) {
                tabRefs.current.set(item.id, node);
              } else {
                tabRefs.current.delete(item.id);
              }
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            title={item.title}
            type="button"
          >
            <span className="cr-nav-icon">
              <EditorIcon name={item.icon} size={item.iconSize ?? 20} />
            </span>
            <span className="cr-nav-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
