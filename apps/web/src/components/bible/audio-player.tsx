'use client';

import { useRef, useState } from 'react';

interface AudioPlayerProps {
  links: Record<string, string>;
  onEnded: () => void;
}

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ links, onEnded }: AudioPlayerProps) {
  const readers = Object.entries(links);
  const [reader, setReader] = useState(readers[0]?.[0] ?? '');
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (readers.length === 0) return null;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  return (
    <div className="bg-surface-container-low dark:bg-surface-raised border border-outline-variant rounded-xl p-4 shadow-soft flex items-center gap-4">
      <audio
        ref={audioRef}
        src={links[reader]}
        onEnded={onEnded}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onDurationChange={(e) => setProgress(0)}
        hidden
      >
        <track kind="captions" label="English captions" />
      </audio>
      <button
        type="button"
        onClick={toggle}
        className="w-11 h-11 rounded-full bg-brand-orange-dark text-on-primary flex items-center justify-center shrink-0"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <span className="material-symbols-outlined">{playing ? 'pause' : 'play_arrow'}</span>
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="h-1.5 rounded-full bg-outline-variant overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${audioRef.current?.duration ? (progress / audioRef.current.duration) * 100 : 0}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-micro text-on-surface-variant">
            Reader
            <select
              className="bg-transparent text-on-surface font-small text-small min-h-[44px]"
              value={reader}
              onChange={(e) => {
                setReader(e.target.value);
                setPlaying(false);
                if (audioRef.current) audioRef.current.currentTime = 0;
              }}
            >
              {readers.map(([key]) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`inline-target px-2 rounded text-micro font-bold ${
                  speed === s ? 'text-primary' : 'text-on-surface-variant'
                }`}
                onClick={() => {
                  setSpeed(s);
                  if (audioRef.current) audioRef.current.playbackRate = s;
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
