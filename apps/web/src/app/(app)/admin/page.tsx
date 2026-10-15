import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Console — TransformLit',
};

/**
 * `/admin` dashboard shell. The route-group `layout.tsx` applies the role gate
 * and the surrounding `(app)` layout supplies `AuthenticatedLayout`/`AppShell`.
 *
 * This is intentionally a shell only: the Dashboard/Books/Announcements/Users/
 * Groups/Audit tab surfaces are implemented by the designer lane against the
 * spec's Frontend Surface section.
 */
export default function AdminPage() {
  return (
    <div className="space-y-8 py-6">
      <header className="space-y-2">
        <p className="font-micro text-xs uppercase tracking-[0.2em] text-on-surface-variant">
          Staff
        </p>
        <h1 className="font-display text-headline-h2 text-on-surface">Admin Console</h1>
        <p className="font-body text-on-surface-variant max-w-2xl">
          Manage the catalog, announcements, members, groups, and audit history.
          Access is limited to administrators and moderators.
        </p>
      </header>

      <section
        aria-label="Admin console sections"
        className="rounded-lg border border-outline-variant bg-surface p-6"
      >
        <p className="font-body text-on-surface-variant">
          Admin tools are being set up. Each section will appear here.
        </p>
      </section>
    </div>
  );
}
