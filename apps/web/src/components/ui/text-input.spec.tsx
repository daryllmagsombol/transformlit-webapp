import { render, screen } from '@testing-library/react';
import { createRef, ReactNode } from 'react';
import { TextInput } from './text-input';

describe('TextInput', () => {
  it('renders an input element', () => {
    render(<TextInput name="email" data-testid="input" />);
    expect(screen.getByTestId('input')).toBeInTheDocument();
  });

  describe('label prop', () => {
    it('renders label with htmlFor matching input id', () => {
      render(<TextInput label="Email" id="email" data-testid="input" />);
      const label = screen.getByText('Email');
      expect(label.tagName).toBe('LABEL');
      expect(label).toHaveAttribute('for', 'email');
    });

    it('uses name as id fallback when id is not provided', () => {
      render(<TextInput label="Email" name="email" data-testid="input" />);
      const label = screen.getByText('Email');
      expect(label).toHaveAttribute('for', 'email');
    });

    it('does not render label when not provided', () => {
      const { container } = render(<TextInput name="email" />);
      expect(container.querySelector('label')).not.toBeInTheDocument();
    });
  });

  describe('error prop', () => {
    it('renders error message with role="alert"', () => {
      render(<TextInput id="email" error="Required field" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Required field');
    });

    it('sets aria-invalid to true when error is present', () => {
      render(<TextInput id="email" error="Required" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'true');
    });

    it('sets aria-describedby to error id', () => {
      render(<TextInput id="email" error="Required" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-describedby', 'email-error');
    });

    it('hides hint when error is present', () => {
      render(<TextInput id="email" error="Required" hint="Enter your email" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Required');
      expect(screen.queryByText('Enter your email')).not.toBeInTheDocument();
    });
  });

  describe('hint prop', () => {
    it('renders hint text when no error', () => {
      render(<TextInput id="email" hint="Enter your email" />);
      expect(screen.getByText('Enter your email')).toBeInTheDocument();
    });

    it('sets aria-describedby to hint id when no error', () => {
      render(<TextInput id="email" hint="Enter your email" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-describedby', 'email-hint');
    });
  });

  describe('icon prop', () => {
    it('renders icon element', () => {
      const icon = <span data-testid="icon">🔍</span>;
      render(<TextInput icon={icon} name="search" />);
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('applies left padding when icon is present', () => {
      const icon = <span data-testid="icon">🔍</span>;
      render(<TextInput icon={icon} name="search" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pl-10');
    });

    it('applies default left padding when no icon', () => {
      render(<TextInput name="search" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pl-4');
    });
  });

  describe('rightElement prop', () => {
    it('renders right element', () => {
      const rightEl = <button type="button">Show</button>;
      render(<TextInput rightElement={rightEl} name="password" />);
      expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
    });

    it('applies right padding when rightElement is present', () => {
      const rightEl = <button type="button">Show</button>;
      render(<TextInput rightElement={rightEl} name="password" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pr-10');
    });

    it('applies default right padding when no rightElement', () => {
      render(<TextInput name="search" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pr-4');
    });
  });

  describe('aria attributes', () => {
    it('sets aria-invalid to false when no error', () => {
      render(<TextInput id="email" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'false');
    });

    it('has no aria-describedby when no error and no hint', () => {
      render(<TextInput id="email" data-testid="input" />);
      expect(screen.getByTestId('input')).not.toHaveAttribute('aria-describedby');
    });
  });

  describe('forwardRef', () => {
    it('forwards ref to the input element', () => {
      const ref = createRef<HTMLInputElement>();
      render(<TextInput ref={ref} name="email" />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current?.tagName).toBe('INPUT');
    });
  });
});
