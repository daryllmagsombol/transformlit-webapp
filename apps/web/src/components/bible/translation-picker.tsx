'use client';

import { Modal } from '../ui/modal';
import { CURATED_TRANSLATIONS } from '../../lib/bible/config';
import { useBibleStore } from '../../store/bible-store';

interface TranslationPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const GROUPS = [
  { label: 'English', ids: CURATED_TRANSLATIONS.filter((t) => t.language === 'English').map((t) => t.id) },
  { label: 'Tagalog', ids: CURATED_TRANSLATIONS.filter((t) => t.language === 'Tagalog').map((t) => t.id) },
];

export function TranslationPicker({ open, onClose }: TranslationPickerProps) {
  const translation = useBibleStore((s) => s.translation);
  const setTranslation = useBibleStore((s) => s.setTranslation);

  return (
    <Modal open={open} onClose={onClose} title="Choose Translation">
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant mb-2">
              {group.label}
            </p>
            <div className="flex flex-col gap-1">
              {group.ids.map((id) => {
                const t = CURATED_TRANSLATIONS.find((x) => x.id === id)!;
                const selected = translation === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTranslation(id);
                      onClose();
                    }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      selected
                        ? 'bg-primary-container/25 dark:bg-primary-container/40 border border-primary/40'
                        : 'hover:bg-surface-container-high'
                    }`}
                  >
                    <span className="font-display text-small font-semibold text-on-surface flex-1">
                      {t.label}
                    </span>
                    <span className="font-micro text-micro text-on-surface-variant">{t.id}</span>
                    {t.hasWords && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-teal-light/15 text-accent-teal-light text-micro font-bold">
                        Word studies
                      </span>
                    )}
                    {t.hasAudio && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-teal-light/15 text-accent-teal-light text-micro font-bold">
                        Audio
                      </span>
                    )}
                    {selected && (
                      <span className="material-symbols-outlined text-primary" aria-label="Selected">
                        check
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="font-micro text-micro text-outline">
          1,250+ translations available — public domain, no copyright restrictions.
        </p>
      </div>
    </Modal>
  );
}
