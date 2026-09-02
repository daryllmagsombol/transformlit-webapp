import { render } from '@testing-library/react';
import {
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  PersonIcon,
  GoogleIcon,
  FacebookIcon,
  MicrosoftIcon,
  SpinnerIcon,
  AutoStoriesIcon,
} from './icons';

const icons = [
  { name: 'MailIcon', Component: MailIcon },
  { name: 'LockIcon', Component: LockIcon },
  { name: 'EyeIcon', Component: EyeIcon },
  { name: 'EyeOffIcon', Component: EyeOffIcon },
  { name: 'PersonIcon', Component: PersonIcon },
  { name: 'GoogleIcon', Component: GoogleIcon },
  { name: 'FacebookIcon', Component: FacebookIcon },
  { name: 'MicrosoftIcon', Component: MicrosoftIcon },
  { name: 'SpinnerIcon', Component: SpinnerIcon },
  { name: 'AutoStoriesIcon', Component: AutoStoriesIcon },
] as const;

describe('Icons', () => {
  it.each(icons)('$name renders an SVG element', ({ Component }) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it.each(icons)('$name applies className prop', ({ Component }) => {
    const { container } = render(<Component className="custom-class" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('custom-class');
  });

  describe('MailIcon', () => {
    it('renders rect and path elements', () => {
      const { container } = render(<MailIcon />);
      expect(container.querySelector('rect')).toBeInTheDocument();
      expect(container.querySelector('path')).toBeInTheDocument();
    });
  });

  describe('LockIcon', () => {
    it('renders rect, circle, and path elements', () => {
      const { container } = render(<LockIcon />);
      expect(container.querySelector('rect')).toBeInTheDocument();
      expect(container.querySelector('circle')).toBeInTheDocument();
      expect(container.querySelector('path')).toBeInTheDocument();
    });
  });

  describe('EyeIcon', () => {
    it('renders path and circle elements', () => {
      const { container } = render(<EyeIcon />);
      expect(container.querySelector('path')).toBeInTheDocument();
      expect(container.querySelector('circle')).toBeInTheDocument();
    });
  });

  describe('EyeOffIcon', () => {
    it('renders path and line elements', () => {
      const { container } = render(<EyeOffIcon />);
      expect(container.querySelector('path')).toBeInTheDocument();
      expect(container.querySelector('line')).toBeInTheDocument();
    });
  });

  describe('PersonIcon', () => {
    it('renders path and circle elements', () => {
      const { container } = render(<PersonIcon />);
      const paths = container.querySelectorAll('path');
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(container.querySelector('circle')).toBeInTheDocument();
    });
  });

  describe('GoogleIcon', () => {
    it('renders multiple colored path elements', () => {
      const { container } = render(<GoogleIcon />);
      const paths = container.querySelectorAll('path');
      expect(paths.length).toBe(4);
    });
  });

  describe('FacebookIcon', () => {
    it('renders a path element', () => {
      const { container } = render(<FacebookIcon />);
      expect(container.querySelector('path')).toBeInTheDocument();
    });
  });

  describe('MicrosoftIcon', () => {
    it('renders four rect elements', () => {
      const { container } = render(<MicrosoftIcon />);
      const rects = container.querySelectorAll('rect');
      expect(rects.length).toBe(4);
    });
  });

  describe('SpinnerIcon', () => {
    it('renders with animate-spin class by default', () => {
      const { container } = render(<SpinnerIcon />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('animate-spin');
    });

    it('renders circle and path elements', () => {
      const { container } = render(<SpinnerIcon />);
      expect(container.querySelector('circle')).toBeInTheDocument();
      expect(container.querySelector('path')).toBeInTheDocument();
    });
  });

  describe('AutoStoriesIcon', () => {
    it('renders multiple path elements', () => {
      const { container } = render(<AutoStoriesIcon />);
      const paths = container.querySelectorAll('path');
      expect(paths.length).toBe(3);
    });
  });
});
