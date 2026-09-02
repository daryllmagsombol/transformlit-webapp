import { render, screen } from '@testing-library/react';

import Route from './page';

jest.mock('../../../../components/groups/group-detail-client', () => ({
  GroupDetailClient: ({ slug }: { slug: string }) => (
    <div data-testid="group-detail-client">{slug}</div>
  ),
}));

describe('GroupDetailPage', () => {
  it('renders the group detail client with the slug', async () => {
    const element = await Route({ params: Promise.resolve({ slug: 'the-bereans' }) });
    render(element);
    expect(screen.getByTestId('group-detail-client')).toHaveTextContent('the-bereans');
  });
});