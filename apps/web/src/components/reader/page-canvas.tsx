'use client';

import { useEffect, useRef } from 'react';
import type { PdfTextItem } from '../../lib/reader/api';
import type { FrameHandle } from '../../lib/reader/repository';

interface PageCanvasProps {
  /** A repository-resolved frame; the canvas never builds a URL itself. */
  readonly frame: FrameHandle;
  readonly items: PdfTextItem[] | null;
}

/**
 * One reader page. The raster frame is presentation-only (aria-hidden); the
 * absolutely-positioned text layer carries selection and screen-reader content.
 * `next/image` is intentionally NOT used: it would proxy and cache protected
 * bytes behind a stable app-origin URL.
 *
 * The frame's URL lifecycle is owned by the repository (a network URL or a Blob
 * URL). This component releases the previous frame on page change and the
 * current frame on unmount, but never constructs a URL itself.
 */
export function PageCanvas({ frame, items }: PageCanvasProps) {
  // Dispose the frame that was active on the previous render. Kept in a ref so
  // an unrelated rerender (e.g. text arriving) never disposes the live frame.
  const previousFrame = useRef<FrameHandle | null>(null);

  useEffect(() => {
    if (previousFrame.current && previousFrame.current !== frame) {
      previousFrame.current.dispose();
    }
    previousFrame.current = frame;
  }, [frame]);

  useEffect(
    () => () => {
      previousFrame.current?.dispose();
      previousFrame.current = null;
    },
    [],
  );

  return (
    <figure className="relative mx-auto w-full max-w-[720px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="page-frame"
        src={frame.url}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block h-auto w-full select-none rounded-md shadow-soft"
      />
      {items ? (
        <div className="absolute inset-0" data-testid="pdf-text-layer">
          {items.map((item) => (
            <span
              key={`${item.x}-${item.y}-${item.t}`}
              className="absolute whitespace-pre text-transparent selection:bg-accent/40"
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                width: `${item.w * 100}%`,
                height: `${item.h * 100}%`,
                fontSize: '13px',
              }}
            >
              {item.t}
            </span>
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-surface-container-high/40" data-testid="page-skeleton" />
      )}
    </figure>
  );
}
