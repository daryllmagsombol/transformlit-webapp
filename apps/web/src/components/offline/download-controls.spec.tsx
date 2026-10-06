import { render, screen, fireEvent } from '@testing-library/react';
import { DownloadControls } from './download-controls';

describe('DownloadControls', () => {
  const baseProps = {
    label: 'Book One',
    onStart: jest.fn(),
    onRetry: jest.fn(),
    onCancel: jest.fn(),
    onRemove: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a download from the idle state', () => {
    render(<DownloadControls {...baseProps} state="IDLE" />);
    fireEvent.click(screen.getByRole('button', { name: /save offline/i }));
    expect(baseProps.onStart).toHaveBeenCalledTimes(1);
  });

  it('exposes progress with an accessible progressbar while staging', () => {
    render(<DownloadControls {...baseProps} state="STAGING" completedItems={2} itemCount={4} />);
    const bar = screen.getByRole('progressbar', { name: /Book One download progress/i });
    expect(bar).toHaveAttribute('value', '50');
    expect(bar).toHaveAttribute('max', '100');
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument();
  });

  it('offers cancel while a transfer is in progress', () => {
    render(<DownloadControls {...baseProps} state="VERIFYING" completedItems={4} itemCount={4} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers remove once ready and announces success', () => {
    render(<DownloadControls {...baseProps} state="READY" />);
    expect(screen.getByText('Saved offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove download/i }));
    expect(baseProps.onRemove).toHaveBeenCalledTimes(1);
  });

  it('offers retry and discard after an interrupted download and shows the error', () => {
    render(<DownloadControls {...baseProps} state="INTERRUPTED" error="Network interrupted" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network interrupted');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
    expect(baseProps.onRemove).toHaveBeenCalledTimes(1);
  });

  it('surfaces a quota/failed state distinctly', () => {
    render(<DownloadControls {...baseProps} state="FAILED" error="Browser storage quota exceeded" />);
    expect(screen.getByText('Download failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/quota exceeded/i);
  });

  it('disables the control and explains denied rights', () => {
    render(
      <DownloadControls {...baseProps} state="IDLE" canDownload={false} deniedReason="Rights not documented" />,
    );
    expect(screen.getByRole('button', { name: /save offline/i })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Rights not documented');
  });

  it('reports unavailable storage honestly', () => {
    render(<DownloadControls {...baseProps} state="IDLE" storageAvailable={false} />);
    expect(screen.getByRole('note')).toHaveTextContent(/offline storage is unavailable/i);
    expect(screen.getByRole('button', { name: /save offline/i })).toBeDisabled();
  });
});
