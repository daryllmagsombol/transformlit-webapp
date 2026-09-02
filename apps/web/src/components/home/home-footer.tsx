import Link from 'next/link';
import { TAGLINE, FOOTER_SOCIALS, CONTACT } from './content';

export function HomeFooter() {
  return (
    <footer id="footer" className="bg-paper border-t border-outline-variant">
      <div className="mx-auto max-w-[1200px] px-6 py-14 grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="font-display text-headline-h3 font-bold text-ink-black inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-4 w-4 rounded-sm bg-brand" />
            Transform Lit
          </p>
          <p className="font-body text-body text-on-surface-variant max-w-xs">{TAGLINE}</p>
          <div className="flex flex-wrap gap-4 pt-1">
            {FOOTER_SOCIALS.map((social) => (
              <Link
                key={social.label}
                href={social.href}
                className="font-small text-small text-on-surface-variant hover:text-primary inline-flex items-center gap-2"
              >
                <span aria-hidden className="material-symbols-outlined">{social.icon}</span>
                {social.label}
              </Link>
            ))}
          </div>
        </div>

        <FooterColumn
          title="About"
          links={[
            { label: 'Transform Lit', href: '#who-we-are' },
            { label: 'MOVE System', href: '#move-system' },
          ]}
        />
        <FooterColumn
          title="Books"
          links={[
            { label: 'MOVE Discipleship', href: '#move-system' },
            { label: 'Theologets Series', href: '#move-system' },
          ]}
        />
        <FooterColumn
          title="Partners"
          links={[
            { label: 'Sponsors', href: '#partner-with-us' },
            { label: 'Churches', href: '#partner-with-us' },
          ]}
        />
      </div>

      <div className="border-t border-outline-variant">
        <div className="mx-auto max-w-[1200px] px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-small text-small text-on-surface-variant">
          <p>© 2026 Transform Lit. All rights reserved.</p>
          <p>
            <span aria-hidden className="material-symbols-outlined align-middle">call</span>{' '}
            {CONTACT.phone}
            <span aria-hidden className="material-symbols-outlined align-middle ml-4">mail</span>{' '}
            <span>{CONTACT.email}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="space-y-3">
      <p className="font-micro text-micro uppercase tracking-[0.1em] text-on-surface-variant">{title}</p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="font-small text-small text-on-surface-variant hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}