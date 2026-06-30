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
  token: null,
  isHydrated: false,
  setAuth: mockSetAuth,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

const mockMutate = jest.fn();

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    mutate: mockMutate,
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

import RegisterForm from './register-form';

describe('RegisterForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSetAuth.mockClear();
    mockAuthState = {
      user: null,
      token: null,
      isHydrated: false,
      setAuth: mockSetAuth,
    };
    mockMutate.mockReset();
    mockAddToast.mockClear();
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
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
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
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
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
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
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
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
      await waitFor(() => {
        expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument();
      });
    });

    it('does not call mutation when validation fails', async () => {
      render(<RegisterForm />);
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);
      await waitFor(() => {
        expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
      });
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe('successful registration', () => {
    it('calls GraphQL registerLocal mutation on valid submit', async () => {
      mockMutate.mockResolvedValue({
        data: {
          registerLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test User', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledTimes(1);
      });

      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            input: {
              displayName: 'Test User',
              email: 'test@example.com',
              password: 'password123',
            },
          },
        }),
      );
    });

    it('redirects to /feed after successful registration', async () => {
      mockMutate.mockResolvedValue({
        data: {
          registerLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test User', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/feed');
      });
    });

    it('calls setAuth with user and tokens on success', async () => {
      const user = { id: '1', email: 'test@example.com', displayName: 'Test User', avatarUrl: null };
      mockMutate.mockResolvedValue({
        data: {
          registerLocal: { user, accessToken: 'access-tok', refreshToken: 'refresh-tok' },
        },
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith(user, 'access-tok', 'refresh-tok');
      });
    });

    it('shows success toast on registration', async () => {
      mockMutate.mockResolvedValue({
        data: {
          registerLocal: {
            user: { id: '1', email: 'test@example.com', displayName: 'Test User', avatarUrl: null },
            accessToken: 'access-tok',
            refreshToken: 'refresh-tok',
          },
        },
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Account created! Welcome to Transformlit.',
          'success',
        );
      });
    });
  });

  describe('failed registration', () => {
    it('displays error toast when mutation fails', async () => {
      mockMutate.mockRejectedValue({
        graphQLErrors: [{ message: 'Email already in use' }],
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Email already in use', 'error');
      });
    });

    it('shows default error message when no specific message available', async () => {
      mockMutate.mockRejectedValue({});

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'Registration failed. Please try again.',
          'error',
        );
      });
    });

    it('does not redirect on failed registration', async () => {
      mockMutate.mockRejectedValue({
        graphQLErrors: [{ message: 'Email already in use' }],
      });

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Full Name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.submit(screen.getByText('Sign Up').closest('form')!);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Email already in use', 'error');
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

      render(<RegisterForm />);
      expect(mockReplace).toHaveBeenCalledWith('/feed');
    });
  });
});
