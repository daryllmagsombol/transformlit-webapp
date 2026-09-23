import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

let mockSetAuth = jest.fn();
let mockAuthState: Record<string, unknown> = {
  user: null,
  isHydrated: false,
  setAuth: mockSetAuth,
  clearAuth: jest.fn(),
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

const mockAddToast = jest.fn();

jest.mock('../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  TextInput: (props: Record<string, unknown>) => {
    const { label, error, icon, rightElement, id, hint, ...rest } = props as Record<string, unknown> & {
      label?: string;
      error?: string;
      icon?: unknown;
      rightElement?: unknown;
      id?: string;
      hint?: string;
    };
    return (
      <div>
        {label && <label htmlFor={id as string}>{label as string}</label>}
        {hint && !error && <span>{hint as string}</span>}
        <input id={id as string} aria-invalid={!!error} {...rest} />
        {error && <span role="alert">{error as string}</span>}
        {rightElement as React.ReactNode}
      </div>
    );
  },
  SpinnerIcon: () => <span data-testid="spinner-icon" />,
  PersonIcon: () => null,
  MailIcon: () => null,
  LockIcon: () => null,
  EyeIcon: () => null,
  EyeOffIcon: () => null,
  GoogleIcon: () => null,
  FacebookIcon: () => null,
  MicrosoftIcon: () => null,
}));

jest.mock('../../components/layout', () => ({
  Footer: () => <div data-testid="footer" />,
}));

jest.mock('../../lib/constants', () => ({
  API_BASE: 'http://localhost:3005',
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import RegisterForm from './register-form';

const registerUser = {
  id: '1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
};

function fillForm() {
  fireEvent.change(screen.getByLabelText('Full Name'), {
    target: { value: 'Test User' },
  });
  fireEvent.change(screen.getByLabelText('Email Address'), {
    target: { value: 'test@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password123' },
  });
}

function submit() {
  fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
}

describe('RegisterForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSetAuth.mockClear();
    mockAddToast.mockClear();
    mockFetch.mockReset();
    mockAuthState = {
      user: null,
      isHydrated: false,
      setAuth: mockSetAuth,
      clearAuth: jest.fn(),
    };
  });

  describe('rendering', () => {
    it('renders all form fields', () => {
      render(<RegisterForm />);
      expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('renders the Sign Up button', () => {
      render(<RegisterForm />);
      expect(screen.getByText('Sign Up')).toBeInTheDocument();
    });

    it('renders the Create Account heading', () => {
      render(<RegisterForm />);
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });

    it('renders a link to the login page', () => {
      render(<RegisterForm />);
      const link = screen.getByText('Log In');
      expect(link.closest('a')).toHaveAttribute('href', '/login');
    });

    it('renders social registration buttons', () => {
      render(<RegisterForm />);
      expect(screen.getByTitle('Register with Google')).toBeInTheDocument();
      expect(screen.getByTitle('Register with Microsoft')).toBeInTheDocument();
      expect(screen.getByTitle('Register with Facebook')).toBeInTheDocument();
    });

    it('renders Terms of Service and Privacy Policy links', () => {
      render(<RegisterForm />);
      expect(screen.getByText('Terms of Service').closest('a')).toHaveAttribute('href', '/terms');
      expect(screen.getByText('Privacy Policy').closest('a')).toHaveAttribute('href', '/privacy');
    });
  });

  describe('validation', () => {
    it('shows errors when submitting empty form', async () => {
      render(<RegisterForm />);
      submit();
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);
      });
    });

    it('shows error for invalid email format', async () => {
      render(<RegisterForm />);
      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'notanemail' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      submit();
      await waitFor(() => {
        expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
      });
    });

    it('shows error when password is too short', async () => {
      render(<RegisterForm />);
      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'short' },
      });
      submit();
      await waitFor(() => {
        expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
      });
    });

    it('shows error when name is too short', async () => {
      render(<RegisterForm />);
      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'A' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      submit();
      await waitFor(() => {
        expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument();
      });
    });

    it('does not call fetch when validation fails', async () => {
      render(<RegisterForm />);
      submit();
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('successful registration', () => {
    it('calls POST /auth/register with credentials on valid submit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: registerUser }),
      });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3005/auth/register',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'Test User',
            email: 'test@example.com',
            password: 'password123',
          }),
        }),
      );
    });

    it('redirects to /feed after successful registration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: registerUser }),
      });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/feed');
      });
    });

    it('calls setAuth with user and access token on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: registerUser }),
      });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith(registerUser, 'access-tok');
      });
    });

    it('shows success toast on registration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: registerUser }),
      });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Account created! Welcome to Transformlit.',
          'success',
        );
      });
    });
  });

  describe('failed registration', () => {
    it('displays error toast when registration fails with a parsed body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Email already in use' }),
      });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Email already in use', 'error');
      });
    });

    it('shows default error message when no specific message available', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Registration failed. Please try again.',
          'error',
        );
      });
    });

    it('does not redirect on failed registration', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 400 });

      render(<RegisterForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Registration failed. Please try again.',
          'error',
        );
      });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('already authenticated', () => {
    it('redirects to /feed when user is already logged in', async () => {
      mockAuthState = {
        user: { id: '1' },
        isHydrated: true,
        setAuth: mockSetAuth,
        clearAuth: jest.fn(),
      };

      render(<RegisterForm />);
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/feed');
      });
    });
  });
});