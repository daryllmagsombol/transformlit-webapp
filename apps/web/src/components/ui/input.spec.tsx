import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Input } from './input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input data-testid="input" />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
  });

  describe('label prop', () => {
    it('renders label when provided', () => {
      render(<Input label="Email" />);
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Email').tagName).toBe('LABEL');
    });

    it('does not render label when not provided', () => {
      const { container } = render(<Input />);
      expect(container.querySelector('label')).not.toBeInTheDocument();
    });
  });

  describe('error prop', () => {
    it('renders error message with role="alert"', () => {
      render(<Input id="email" error="Required field" />);
      const errorEl = screen.getByRole('alert');
      expect(errorEl).toHaveTextContent('Required field');
    });

    it('sets aria-invalid to true when error is present', () => {
      render(<Input id="email" error="Required" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'true');
    });

    it('sets aria-describedby pointing to error element', () => {
      render(<Input id="email" error="Required" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveAttribute('aria-describedby', 'email-error');
      expect(document.getElementById('email-error')).toHaveTextContent('Required');
    });

    it('applies input-error class when error is present', () => {
      render(<Input id="email" error="Required" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('input-error');
    });

    it('does not render error when not provided', () => {
      render(<Input id="email" data-testid="input" />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('forwardRef', () => {
    it('forwards ref to the input element', () => {
      const ref = createRef<HTMLInputElement>();
      render(<Input ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current?.tagName).toBe('INPUT');
    });
  });
});
