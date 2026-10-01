import { render, screen } from '@testing-library/react';
import { BibleReaderView } from './bible-reader-view';
import { ToastProvider } from '../ui/toast';
import type { BibleCapabilities } from '../../lib/bible/repository';
import type { TranslationBook } from '../../lib/bible/types';

jest.mock('next/link', () => {
  return function MockLink({ children, href }: Record<string, unknown>) {
    return <a href={href as string}>{children}</a>;
  };
});

jest.mock('../../lib/bible/api', () => ({
  getChapter: jest.fn().mockResolvedValue({ numberOfVerses: 1 }),
  fetchBible: jest.fn(),
}));

jest.mock('../../lib/hooks/use-cross-references', () => ({
  useCrossReferences: () => ({ byVerse: {}, loading: false, load: jest.fn() }),
}));

const books: TranslationBook[] = [
  { id: 'ROM', name: 'Romans', commonName: 'Romans', title: null, order: 45, numberOfChapters: 16, firstChapterNumber: 1, lastChapterNumber: 16, totalNumberOfVerses: 433 },
];

const LOCAL_CAPABILITIES: BibleCapabilities = {
  audio: false,
  remoteSearch: false,
  enrichment: false,
  realtime: false,
  navigation: true,
};

function renderView(attribution?: string) {
  return render(
    <ToastProvider>
      <BibleReaderView
        translation="PERMITTED"
        bookId="ROM"
        chapter={8}
        book={books[0]}
        translationMeta={{ id: 'PERMITTED', name: 'Permitted Version', shortName: 'PV' }}
        content={[{ type: 'verse', number: 1, content: ['There is therefore now'] }]}
        footnotes={[]}
        books={books}
        capabilities={LOCAL_CAPABILITIES}
        onNavigate={jest.fn()}
        onBack={jest.fn()}
        attribution={attribution}
      />
    </ToastProvider>,
  );
}

describe('BibleReaderView attribution', () => {
  it('renders the stored translation attribution when present', () => {
    renderView('Scripture text provided by Example Publisher.');
    expect(screen.getByTestId('bible-attribution')).toHaveTextContent(
      'Scripture text provided by Example Publisher.',
    );
  });

  it('renders no attribution slot when none is recorded', () => {
    renderView('');
    expect(screen.queryByTestId('bible-attribution')).not.toBeInTheDocument();
  });
});
