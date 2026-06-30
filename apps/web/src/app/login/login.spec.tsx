import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string | null> = {};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams[key] ?? null,
  }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

let mockSetAuth = jest.fn();
let mockAuthState: Record<string, unknown> = {
  user: null,
  token: null,
  isHydrated: false,
  setAuth: mockSetAuth,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('../../lib/auth', () => ({
  setAccessToken: jest.fn(),
  setRefreshToken: jest.fn(),
  removeAccessToken: jest.fn(),
  removeRefreshToken: jest.fn(),
}));

const mockMutate = jest.fn();
const mockQuery = jest.fn();

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    mutate: mockMutate,
    query: mockQuery,
  },
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

import LoginForm from './login-form';

describe('LoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSearchParams = {};
    mockSetAuth.mockClear();
    mockAuthState = {
      user: null,
      token: null,
      isHydrated: false,
      setAuth: mockSetAuth,
    };
    mockMutate.mockReset();
    mockQuery.mockReset();
    mockAddToast.mockClear();
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

  describe('validation', () => {
    it('shows error when submitting empty form', async () => {
      render(<LoginForm />);
      fireEvent.submit(screen.getByText('Log In').closest('form')!);
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
      fireEvent.submit(screen.getByText('Log In').closest('form')!);
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
      fireEvent.submit(screen.getByText('Log In').closest('form')!);
      await waitFor(() => {
        expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
      });
    });

    it('does not call mutation when validation fails', async () => {
      render(<LoginForm />);
      fireEvent.submit(screen.getByText('Log In').closest('form')!);
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
      });
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe('successful login', () => {
    it('calls GraphQL loginLocal mutation on valid submit', async () => {
      mockMutate.mockResolvedValue({
        data: {
          loginLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledTimes(1);
      });

      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            input: { email: 'test@example.com', password: 'password123' },
          },
        }),
      );
    });

    it('redirects to /feed after successful login', async () => {
      mockMutate.mockResolvedValue({
        data: {
          loginLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/feed');
      });
    });

    it('calls setAuth with user and tokens on success', async () => {
      const user = { id: '1', email: 'test@example.com', displayName: 'Test', avatarUrl: null };
      mockMutate.mockResolvedValue({
        data: {
          loginLocal: { user, accessToken: 'access-tok', refreshToken: 'refresh-tok' },
        },
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith(user, 'access-tok', 'refresh-tok');
      });
    });

    it('shows success toast on login', async () => {
      mockMutate.mockResolvedValue({
        data: {
          loginLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Welcome back!', 'success');
      });
    });
  });

  describe('failed login', () => {
    it('displays error toast when mutation fails', async () => {
      mockMutate.mockRejectedValue({
        graphQLErrors: [{ message: 'Invalid credentials' }],
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Invalid credentials', 'error');
      });
    });

    it('shows default error message when no specific message available', async () => {
      mockMutate.mockRejectedValue({});

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Invalid email or password', 'error');
      });
    });

    it('does not redirect on failed login', async () => {
      mockMutate.mockRejectedValue({
        graphQLErrors: [{ message: 'Invalid credentials' }],
      });

      render(<LoginForm />);

      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Log In').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Invalid credentials', 'error');
      });
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('already authenticated', () => {
    it('redirects to /feed when user is already logged in', () => {
      mockAuthState = {
        user: { id: '1' },
        token: 'existing-token',
        isHydrated: true,
        setAuth: mockSetAuth,
      };

      render(<LoginForm />);
      expect(mockReplace).toHaveBeenCalledWith('/feed');
    });
  });
});
