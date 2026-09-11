import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help — Transformlit',
};

const FAQ_ITEMS = [
  {
    question: 'How do I start reading?',
    answer:
      'Your home feed shows what you are reading and what is next. Pick up any book to continue where you left off.',
  },
  {
    question: 'What are reading groups?',
    answer:
      'Groups let you read alongside others and talk through what you find. You can join an existing group or start your own.',
  },
  {
    question: 'Can I read the Bible here?',
    answer:
      'Yes. The Bible section has multiple translations, and you can move between books and chapters as you read.',
  },
  {
    question: 'How do I manage my account?',
    answer:
      'Account settings are not available yet. Once they are, this is where you will update your profile and preferences.',
  },
] as const;

export default function HelpPage() {
  return (
    <div className="max-w-[800px] mx-auto py-8">
      <header className="mb-8 border-b border-outline-variant pb-4">
        <h1 className="font-display text-headline-h1 text-on-surface">Help</h1>
        <p className="font-body text-body text-on-surface-variant mt-2 max-w-lg">
          Answers to common questions. If you need anything else, reach out to the team and we
          will get back to you.
        </p>
      </header>

      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="font-display text-headline-h4 text-on-surface mb-3">
          Frequently asked questions
        </h2>
        <div className="rounded-xl border border-outline-variant bg-surface-container-low divide-y divide-outline-variant overflow-hidden">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer list-none font-display text-headline-h4 text-on-surface transition-colors hover:bg-surface-container-highest/50">
                {item.question}
                <span
                  className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180"
                  aria-hidden="true"
                >
                  expand_more
                </span>
              </summary>
              <p className="font-body text-body text-on-surface-variant px-4 pb-4">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
