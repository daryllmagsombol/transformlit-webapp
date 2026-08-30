import { render, screen } from '@testing-library/react';
import { AudioPlayer } from './audio-player';
import { ChapterNav } from './chapter-nav';

describe('AudioPlayer', () => {
  it('renders nothing when there are no links', () => {
    const { container } = render(<AudioPlayer links={{}} onEnded={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a reader select with the available readers', () => {
    render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3', souer: 'https://x/s.mp3' }} onEnded={() => {}} />);
    expect(screen.getByLabelText('Reader')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

describe('ChapterNav', () => {
  it('renders prev and next links', () => {
    render(
      <ChapterNav
        prev={{ href: '/bible/BSB/ROM/11', label: 'Romans 11' }}
        next={{ href: '/bible/BSB/ROM/13', label: 'Romans 13' }}
      />,
    );
    expect(screen.getByText('‹ Romans 11')).toBeInTheDocument();
    expect(screen.getByText('Romans 13 ›')).toBeInTheDocument();
  });

  it('renders a single disabled state when links are missing', () => {
    render(<ChapterNav prev={null} next={null} />);
    expect(screen.getByText('Start of the Bible')).toBeInTheDocument();
  });
});
