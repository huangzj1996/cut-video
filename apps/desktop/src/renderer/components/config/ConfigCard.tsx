import type { PropsWithChildren } from 'react';

export function ConfigCard({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <section className={`rounded-[14px] border border-[#30343c] bg-[#1a1c20] ${className}`}>
      {children}
    </section>
  );
}
