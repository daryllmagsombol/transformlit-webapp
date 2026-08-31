import { render, screen, fireEvent } from '@testing-library/react';
import { AudioPlayer } from './audio-player';
import { ChapterNav } from './chapter-nav';

describe('AudioPlayer', () => {
  beforeAll(() => {
    HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = jest.fn();
  });

  it('renders nothing when there are no links', () => {
    const { container } = render(<AudioPlayer links={{}} onEnded={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a reader select with the available readers', () => {
    render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3', souer: 'https://x/s.mp3' }} onEnded={() => {}} />);
    expect(screen.getByLabelText('Reader')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('toggles between play and pause', () => {
    const { container } = render(
      <AudioPlayer links={{ gilbert: 'https://x/g.mp3' }} onEnded={() => {}} />,
    );
    const playButton = screen.getByRole('button', { name: 'Play' });
    fireEvent.click(playButton);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    const audio = container.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe('https://x/g.mp3');
  });

  it('switches readers and resets playback', () => {
    render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3', souer: 'https://x/s.mp3' }} onEnded={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.change(screen.getByLabelText('Reader'), { target: { value: 'souer' } });
    const audio = document.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe('https://x/s.mp3');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('changes playback speed', () => {
    render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3' }} onEnded={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '1.5×' }));
    const audio = document.querySelector('audio');
    expect((audio as HTMLAudioElement).playbackRate).toBe(1.5);
  });

  it('fires onEnded when the audio finishes and tracks progress', () => {
    const onEnded = jest.fn();
    const { container } = render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3' }} onEnded={onEnded} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 60, configurable: true });
    fireEvent.timeUpdate(audio, { target: { currentTime: 30 } });
    expect((screen.getByRole('button', { name: 'Play' }).nextElementSibling as HTMLElement)?.textContent).toBeDefined();
    fireEvent.ended(audio);
    expect(onEnded).toHaveBeenCalled();
  });

  it('resets progress when the duration changes', () => {
    const { container } = render(<AudioPlayer links={{ gilbert: 'https://x/g.mp3' }} onEnded={() => {}} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.durationChange(audio);
    expect(audio).toBeInTheDocument();
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
