import Link from 'next/link';

const CONTACT_EMAIL = 'hello@transformlit.com';

export function PartnerCta() {
  return (
    <section id="partner-with-us" className="mx-auto max-w-[1200px] px-6 py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-start">
        <div className="space-y-6">
          <h2 className="font-display text-headline-h2 text-ink-black">Partner With Us</h2>
          <p className="font-body text-body text-on-surface-variant">
            Transform Lit partners with churches, church leaders, and para-church
            organizations in molding transformed followers who raise transformed
            followers — through self-published books, curriculums, and systems.
          </p>
          <ul className="space-y-3 font-body text-body text-on-surface-variant">
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">church</span>
              Church discipleship programs and small groups
            </li>
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">school</span>
              Leadership trainings and events
            </li>
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">menu_book</span>
              Curriculum licensing and bulk book orders
            </li>
          </ul>
          <p className="font-small text-small text-on-surface-variant">
            Donations and contributions support our operational and self-publication
            funds, keeping the organization sustainable and functional.
          </p>
        </div>

        <aside className="card bg-paper-warm space-y-4">
          <h3 className="font-display text-headline-h3 text-ink-black">
            Start a Partnership Conversation
          </h3>
          <p className="font-body text-body text-on-surface-variant">
            Tell us about your church or ministry. We&apos;ll respond with how the
            MOVE system can fit your context.
          </p>
          <Link href={`mailto:${CONTACT_EMAIL}`} className="btn-primary w-full sm:w-auto">
            Partner With Us
          </Link>
          <div className="pt-2 space-y-1 font-small text-small text-on-surface-variant">
            <p>
              <span aria-hidden className="material-symbols-outlined align-middle text-primary">call</span>{' '}
              0927-412-2292
            </p>
            <p>
              <span aria-hidden className="material-symbols-outlined align-middle text-primary">mail</span>{' '}
              {CONTACT_EMAIL}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}