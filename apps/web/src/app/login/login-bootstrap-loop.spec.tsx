import { render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '../../store';

/**
 * C1 regression: mounting the login page must NOT self-redirect when the
 * bootstrap refresh gets a genuine 401. bootstrapAuth() is invoked only by this
 * page, so any redirect here reloads /login → bootstrap → 401 → reload forever.
 *
 * Deliberately does NOT mock `bootstrapAuth`/apollo-client: the real module runs
 * against a 401 fetch so the redirect suppression is exercised end-to-end.
 */

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => ({ get: () => null }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

jest.mock('../../components/ui', () => ({
  useToast: () => ({ addToast: jest.fn() }),
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

jest.mock('../../components/offline/account-recovery-prompt', () => ({
  AccountRecoveryPrompt: () => null,
}));

jest.mock('../../lib/constants', () => ({
  API_BASE: 'http://localhost:3005',
}));

jest.mock('graphql-ws', () => ({ createClient: jest.fn(() => ({})) }));

import LoginForm from './login-form';

describe('LoginForm bootstrap auth (C1 no reload loop)', () => {
  const fetchMock = jest.fn();
  const hrefSetter = jest.fn();
  let hrefDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    hrefDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.window.Location.prototype,
      'href',
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    hrefSetter.mockReset();
    // Intercept the ONLY navigation mechanism the default auth redirect uses.
    if (hrefDescriptor) {
      Object.defineProperty(globalThis.window.Location.prototype, 'href', {
        ...hrefDescriptor,
        set: hrefSetter,
      });
    }
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    useAuthStore.setState({ user: null, isHydrated: true });
    localStorage.clear();
  });

  afterAll(() => {
    if (hrefDescriptor) {
      Object.defineProperty(globalThis.window.Location.prototype, 'href', hrefDescriptor);
    }
  });

  it('does not navigate (no location.href redirect) when a genuine 401 is returned', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    render(<LoginForm />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let bootstrap and any microtask-driven redirect settle.
    await waitFor(() => expect(screen.getByText('Log In')).toBeInTheDocument());

    expect(hrefSetter).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
