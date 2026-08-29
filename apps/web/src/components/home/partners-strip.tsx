import { PARTNERS } from './content';

export function PartnersStrip() {
  return (
    <section className="border-y border-outline-variant bg-surface-container-low py-10">
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="font-micro text-micro uppercase tracking-[0.15em] text-on-surface-variant text-center">
          Partners & Sponsors
        </p>
        <div className="flex flex-wrap items-center justify-center gap-10 mt-6 opacity-60">
          {PARTNERS.map((partner) => (
            <span key={partner.name} className="font-display text-headline-h4 text-on-surface-variant">
              {partner.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}