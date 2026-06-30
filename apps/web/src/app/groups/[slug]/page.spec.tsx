import { render, screen } from '@testing-library/react';

jest.mock('../../../components/layout/authenticated-layout', () => ({
  AuthenticatedLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="authenticated-layout">{children}</div>
  ),
}));

import Route from './page';

describe('GroupDetailPage', () => {
  it('renders the group name from slug', async () => {
    const element = await Route({ params: Promise.resolve({ slug: 'the-bereans' }) });
    render(element);
    expect(screen.getByText('the bereans')).toBeInTheDocument();
  });

  it('renders the coming soon message', async () => {
    const element = await Route({ params: Promise.resolve({ slug: 'my-group' }) });
    render(element);
    expect(screen.getByText('Group detail view coming soon.')).toBeInTheDocument();
  });

  it('renders inside the authenticated layout', async () => {
    const element = await Route({ params: Promise.resolve({ slug: 'test-group' }) });
    render(element);
    expect(screen.getByTestId('authenticated-layout')).toBeInTheDocument();
  });

  it('replaces hyphens in slug with spaces', async () => {
    const element = await Route({ params: Promise.resolve({ slug: 'morning-devotionals' }) });
    render(element);
    expect(screen.getByText('morning devotionals')).toBeInTheDocument();
  });
});
