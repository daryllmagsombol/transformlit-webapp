import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => ({ get: () => null }),
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
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
    {
      getState: () => mockAuthState,
    }
  ),
}));

const mockBootstrapAuth = jest.fn();

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {},
  bootstrapAuth: () => mockBootstrapAuth(),
  resetApolloState: jest.fn(),
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
        <input id={id as string} aria-invalid={!!error} {...rest} />
        {error && <span role="alert">{error as string}</span>}
        {rightElement as React.ReactNode}
      </div>
    );
  },
  SpinnerIcon: () => <span data-testid="spinner-icon" />,
  MailIcon: () => null,
  LockIcon: () => null,
  EyeIcon: () => null,
  EyeOffIcon: () => null,
  AutoStoriesIcon: () => null,
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

import LoginForm from './login-form';

const loginUser = { id: '1', email: 'test@example.com', displayName: 'Test', avatarUrl: null };

function fillForm() {
  fireEvent.change(screen.getByLabelText('Email Address'), {
    target: { value: 'test@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password123' },
  });
}

function submit() {
  fireEvent.submit(screen.getByText('Log In').closest('form')!);
}

describe('LoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSetAuth.mockClear();
    mockBootstrapAuth.mockReset();
    mockBootstrapAuth.mockResolvedValue(false);
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
    it('renders email and password fields', () => {
      render(<LoginForm />);
      expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('renders the Log In button', () => {
      render(<LoginForm />);
      expect(screen.getByText('Log In')).toBeInTheDocument();
    });

    it('renders the Welcome Back heading', () => {
      render(<LoginForm />);
      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    });

    it('renders a link to the register page', () => {
      render(<LoginForm />);
      const link = screen.getByText('Register here.');
      expect(link.closest('a')).toHaveAttribute('href', '/register');
    });

    it('renders a Forgot password link', () => {
      render(<LoginForm />);
      const link = screen.getByText('Forgot?');
      expect(link.closest('a')).toHaveAttribute('href', '/forgot-password');
    });

    it('renders social login buttons', () => {
      render(<LoginForm />);
      expect(screen.getByTitle('Login with Google')).toBeInTheDocument();
      expect(screen.getByTitle('Login with Microsoft')).toBeInTheDocument();
      expect(screen.getByTitle('Login with Facebook')).toBeInTheDocument();
    });
  });

  describe('session bootstrap', () => {
    it('calls bootstrapAuth on mount to detect the OAuth httpOnly cookie', async () => {
      render(<LoginForm />);
      await waitFor(() => expect(mockBootstrapAuth).toHaveBeenCalledTimes(1));
    });

    it('redirects to /feed when bootstrap finds an existing session', async () => {
      mockBootstrapAuth.mockResolvedValue(true);
      mockAuthState = { ...mockAuthState, isHydrated: true, user: loginUser };

      render(<LoginForm />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/feed');
      });
    });

    it('stays on the login page when bootstrap finds no session', async () => {
      render(<LoginForm />);
      await waitFor(() => expect(mockBootstrapAuth).toHaveBeenCalledTimes(1));
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('shows error when submitting empty form', async () => {
      render(<LoginForm />);
      submit();
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
      });
    });

    it('shows email validation error for invalid email', async () => {
      render(<LoginForm />);
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

    it('shows password error when password is too short', async () => {
      render(<LoginForm />);
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'abc' },
      });
      submit();
      await waitFor(() => {
        expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
      });
    });

    it('does not call fetch when validation fails', async () => {
      render(<LoginForm />);
      submit();
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('successful login', () => {
    it('calls POST /auth/login with credentials on valid submit', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: loginUser }),
      });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3005/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
          }),
        }),
      );
    });

    it('redirects to /feed after successful login', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: loginUser }),
      });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/feed');
      });
    });

    it('calls setAuth with user and access token on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: loginUser }),
      });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith(loginUser, 'access-tok');
      });
    });

    it('shows success toast on login', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'access-tok', user: loginUser }),
      });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Welcome back!', 'success');
      });
    });
  });

  describe('failed login', () => {
    it('displays an error toast when the request fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Invalid email or password', 'error');
      });
    });

    it('shows the server-provided error message when the body parses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Account disabled' }),
      });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Account disabled', 'error');
      });
    });

    it('does not redirect on failed login', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      render(<LoginForm />);
      fillForm();
      submit();

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Invalid email or password', 'error');
      });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});