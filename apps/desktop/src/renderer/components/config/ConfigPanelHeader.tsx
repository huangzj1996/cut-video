import type { PropsWithChildren } from 'react';

interface ConfigPanelHeaderProps extends PropsWithChildren {
  className?: string;
}

export function ConfigPanelHeader({ children, className = 'pt-[18px]' }: ConfigPanelHeaderProps) {
  return <header className={`shrink-0 px-4 pb-[5px] ${className}`}>{children}</header>;
}
