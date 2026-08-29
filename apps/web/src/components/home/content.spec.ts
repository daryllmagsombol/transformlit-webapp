import { NAV_LINKS, PILLARS, BOOKS, ANNOUNCEMENTS, PARTNERS, TAGLINE, FOOTER_SOCIALS } from './content';

describe('homepage content', () => {
  it('nav has 5 links including the partner target', () => {
    expect(NAV_LINKS).toHaveLength(5);
    expect(NAV_LINKS.map((l) => l.href)).toContain('#partner-with-us');
  });

  it('exports the brand tagline', () => {
    expect(TAGLINE).toBe('Turning Pages, Turning Hearts.');
  });

  it('has 3 pillars each with icon, title, description', () => {
    expect(PILLARS).toHaveLength(3);
    for (const p of PILLARS) {
      expect(p.icon).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it('has the 4 MOVE books in order Usbong, Usad, Unlad, Ugnay, each with a Shopee link', () => {
    expect(BOOKS.map((b) => b.title)).toEqual(['Usbong', 'Usad', 'Unlad', 'Ugnay']);
    expect(BOOKS.map((b) => b.step)).toEqual([1, 2, 3, 4]);
    for (const book of BOOKS) {
      expect(book.shopeeUrl).toMatch(/^https:\/\/shopee\.ph\//);
    }
  });

  it('has 4 footer socials including Google Play', () => {
    expect(FOOTER_SOCIALS).toHaveLength(4);
    expect(FOOTER_SOCIALS.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Facebook', 'Instagram', 'Google Play', 'Shopee']),
    );
  });

  it('has real announcements and at least one partner', () => {
    expect(ANNOUNCEMENTS.map((a) => a.title)).toContain('Tahanan Registration — Open');
    expect(ANNOUNCEMENTS.map((a) => a.title)).toContain('Book 4: Ugnay Now Available');
    expect(PARTNERS.length).toBeGreaterThanOrEqual(1);
  });
});