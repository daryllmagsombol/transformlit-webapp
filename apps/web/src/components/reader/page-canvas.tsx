'use client';

import { pageFrameUrl, PdfTextItem } from '../../lib/reader/api';

interface PageCanvasProps {
  readonly bookId: string;
  readonly page: number;
  readonly items: PdfTextItem[] | null;
}

/**
 * One reader page. The raster frame is presentation-only (aria-hidden); the
 * absolutely-positioned text layer carries selection and screen-reader content.
 * `next/image` is intentionally NOT used: it would proxy and cache protected
 * bytes behind a stable app-origin URL.
 */
export function PageCanvas({ bookId, page, items }: PageCanvasProps) {
  return (
    <figure className="relative mx-auto w-full max-w-[720px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="page-frame"
        src={pageFrameUrl(bookId, page)}
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
