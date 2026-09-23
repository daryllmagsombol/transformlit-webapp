import '@testing-library/jest-dom';

// Mock window.matchMedia for responsive sidebar logic
Object.defineProperty(globalThis.window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

// Mock IntersectionObserver for motion's whileInView (jsdom lacks it)
class MockIntersectionObserver {
  observe() {
    // Intentionally empty
  }
  unobserve() {
    // Intentionally empty
  }
  disconnect() {
    // Intentionally empty
  }
  takeRecords() {
    return [];
  }
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});
