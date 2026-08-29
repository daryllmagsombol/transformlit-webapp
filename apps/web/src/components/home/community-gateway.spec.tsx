import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { CommunityGateway } from './community-gateway';

describe('CommunityGateway', () => {
  it('renders the three spotlight cards including Tahanan', () => {
    render(<CommunityGateway />);
    expect(screen.getByText('Community Groups')).toBeInTheDocument();
    expect(screen.getByText('Books & Library')).toBeInTheDocument();
    expect(screen.getByText('Tahanan Campus Community Group')).toBeInTheDocument();
  });

  it('renders the join banner linking to /register and the app to Google Play', () => {
    render(<CommunityGateway />);
    expect(screen.getByText('Join the TransformLit Community')).toBeInTheDocument();
    expect(screen.getByText('Join the Community')).toHaveAttribute('href', '/register');
    expect(screen.getByText('Get the App')).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.transformlit.app',
    );
  });
});
