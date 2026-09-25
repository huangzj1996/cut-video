import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MUSIC_CATEGORY_WIDTHS, MUSIC_EXTRA_CATEGORIES, MUSIC_PRIMARY_CATEGORIES, getVisibleMusicCategories } from '../../../constants/music';
import type { MusicCategory } from '../../../types/music';

interface MusicCategoryPickerProps {
  value: MusicCategory;
  onChange: (category: MusicCategory) => void;
}

export function MusicCategoryPicker({ value, onChange }: MusicCategoryPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [availableWidth, setAvailableWidth] = useState(260);
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleCategories = getVisibleMusicCategories(availableWidth);
  const menuCategories = [...MUSIC_PRIMARY_CATEGORIES.slice(visibleCategories.length), ...MUSIC_EXTRA_CATEGORIES];
  const moreSelected = menuCategories.includes(value);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        moreButtonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  function select(category: MusicCategory) {
    onChange(category);
    setMenuOpen(false);
  }

  return (
    <div ref={pickerRef} className="relative mt-[13px] w-full min-w-0">
      <div ref={containerRef} role="group" aria-label="音乐分类" className="flex h-[30px] w-full min-w-0 items-center gap-1">
        {visibleCategories.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={value === category}
            onClick={() => select(category)}
            style={{ width: MUSIC_CATEGORY_WIDTHS[category] }}
            className={`h-[30px] shrink-0 rounded-lg border text-[11px] font-extrabold transition-colors duration-150 hover:bg-[#3A3B3E] ${value === category ? 'border-[var(--accent-red)] bg-[#F05F7326] text-[var(--accent-red)]' : 'border-[#242529] bg-[#242529] text-[#D5D8DE]'}`}
          >
            {category}
          </button>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          aria-label="更多音乐分类"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`flex h-[30px] w-7 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 hover:bg-[#3A3B3E] ${moreSelected ? 'border-[var(--accent-red)] bg-[#F05F7326] text-[var(--accent-red)]' : 'border-[#242529] bg-[#242529] text-[#D5D8DE]'}`}
        >
          <ChevronDown size={16} className={`transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {menuOpen && (
        <div role="menu" aria-label="更多音乐分类" className="absolute top-[34px] right-0 z-20 min-w-[92px] rounded-lg border border-[#3A3B3E] bg-[#242529] p-1 shadow-xl">
          {menuCategories.map((category) => (
            <button key={category} type="button" role="menuitemradio" aria-checked={value === category} onClick={() => select(category)} className={`block h-[30px] w-full rounded-md px-2 text-left text-[11px] font-bold transition-colors hover:bg-[#3A3B3E] ${value === category ? 'text-[var(--accent-red)]' : 'text-[#D5D8DE]'}`}>
              {category}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
