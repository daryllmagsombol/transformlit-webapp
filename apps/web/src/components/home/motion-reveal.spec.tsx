import { render, screen } from '@testing-library/react';

import { Reveal } from './motion-reveal';

describe('Reveal', () => {
  it('renders its children', () => {
    render(<Reveal>Hello Reveal</Reveal>);
    expect(screen.getByText('Hello Reveal')).toBeInTheDocument();
  });

  it('accepts a className', () => {
    render(
      <Reveal className="test-class">
        <span>Content</span>
      </Reveal>,
    );
    expect(document.querySelector('.test-class')).toBeInTheDocument();
  });
});