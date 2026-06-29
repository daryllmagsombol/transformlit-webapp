import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './toast';

let idCounter = 0;
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `test-id-${++idCounter}` },
    configurable: true,
  });
});

beforeEach(() => {
  idCounter = 0;
});

function ToastTrigger({ message, type }: { message: string; type?: 'success' | 'error' | 'info' }) {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast(message, type)}>Add Toast</button>
  );
}

describe('ToastProvider', () => {
  it('renders children', () => {
    render(
      <ToastProvider>
        <div>Child Content</div>
      </ToastProvider>,
    );
    expect(screen.getByText('Child Content')).toBeInTheDocument();
  });

  it('renders aria-live="polite" container', () => {
    const { container } = render(
      <ToastProvider>
        <div>Content</div>
      </ToastProvider>,
    );
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });
});

describe('useToast', () => {
  it('throws when used outside ToastProvider', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ToastTrigger message="hi" />)).toThrow(
      'useToast must be used within ToastProvider',
    );
    consoleSpy.mockRestore();
  });

  it('returns addToast function', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="test" />
      </ToastProvider>,
    );
    expect(screen.getByText('Add Toast')).toBeInTheDocument();
  });

  it('creates a toast with message when addToast is called', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Hello Toast" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Hello Toast')).toBeInTheDocument();
  });

  it('applies bg-success class for success type', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Success!" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-success');
  });

  it('applies bg-error class for error type', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error!" type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-error');
  });

  it('applies bg-accent class for info type (default)', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Info!" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-accent');
  });

  it('defaults to info type when no type specified', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Default" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-accent');
  });

  it('renders dismiss button with aria-label="Dismiss"', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Dismiss me" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
  });

  it('removes toast when dismiss button is clicked', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Dismiss me" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Dismiss me')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });

  it('auto-dismisses toast after 4000ms', () => {
    jest.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTrigger message="Auto dismiss" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    expect(screen.getByText('Auto dismiss')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Auto dismiss')).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it('does not auto-dismiss before 4000ms', () => {
    jest.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTrigger message="Still here" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Add Toast'));
    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(screen.getByText('Still here')).toBeInTheDocument();
    jest.useRealTimers();
  });
});
