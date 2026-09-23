import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings — Transformlit',
};

const SETTINGS_SECTIONS = [
  {
    id: 'account',
    title: 'Account',
    items: ['Profile and display name', 'Email and password', 'Connected accounts'],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    items: ['Reading reminders', 'Friend requests', 'Group activity'],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    items: ['Light or dark theme', 'Text size', 'Reader layout'],
  },
] as const;

export default function SettingsPage() {
  return (
    <div className="max-w-[800px] mx-auto py-8">
      <header className="mb-8 border-b border-outline-variant pb-4">
        <h1 className="font-display text-headline-h1 text-on-surface">Settings</h1>
        <p className="font-body text-body text-on-surface-variant mt-2 max-w-lg">
          Settings aren&apos;t built yet. These are the areas we plan to add first, so you know
          what&apos;s coming.
        </p>
      </header>

      <div className="space-y-8">
        {SETTINGS_SECTIONS.map((section) => (
          <section key={section.id} aria-labelledby={`${section.id}-heading`}>
            <h2
              id={`${section.id}-heading`}
              className="font-display text-headline-h4 text-on-surface mb-3"
            >
              {section.title}
            </h2>
            <ul className="rounded-xl border border-outline-variant bg-surface-container-low divide-y divide-outline-variant overflow-hidden">
              {section.items.map((item) => (
                <li key={item} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="font-body text-body text-on-surface-variant">{item}</span>
                  <span className="shrink-0 font-micro text-micro uppercase tracking-widest text-on-surface-variant/70 border border-outline-variant rounded-full px-2 py-0.5">
                    Soon
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
