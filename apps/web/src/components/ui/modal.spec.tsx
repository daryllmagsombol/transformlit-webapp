import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './modal';

describe('Modal', () => {
  it('renders null when open=false', () => {
    const { container } = render(
      <Modal open={false} onClose={jest.fn()}>Content</Modal>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with role="dialog" and aria-modal="true" when open=true', () => {
    render(<Modal open={true} onClose={jest.fn()}>Content</Modal>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders children when open', () => {
    render(<Modal open={true} onClose={jest.fn()}>Hello World</Modal>);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Modal open={true} onClose={jest.fn()} title="My Title">Content</Modal>);
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('does not render title when not provided', () => {
    render(<Modal open={true} onClose={jest.fn()}>Content</Modal>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders close button with aria-label="Close" when title is provided', () => {
    render(<Modal open={true} onClose={jest.fn()} title="Title">Content</Modal>);
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(<Modal open={true} onClose={onClose} title="Title">Content</Modal>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = jest.fn();
    const { container } = render(
      <Modal open={true} onClose={onClose}>Content</Modal>,
    );
    const backdrop = container.querySelector('.absolute.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = jest.fn();
    render(<Modal open={true} onClose={onClose}>Content</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when closed', () => {
    const onClose = jest.fn();
    render(<Modal open={false} onClose={onClose}>Content</Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sets body overflow hidden when open', () => {
    render(<Modal open={true} onClose={jest.fn()}>Content</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body overflow when closed', () => {
    const { rerender } = render(
      <Modal open={true} onClose={jest.fn()}>Content</Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Modal open={false} onClose={jest.fn()}>Content</Modal>);
    expect(document.body.style.overflow).toBe('');
  });
});
