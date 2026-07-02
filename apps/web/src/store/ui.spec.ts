import { useUIStore } from './ui';

describe('UI Store', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarOpen: false });
  });

  describe('initial state', () => {
    it('has sidebarOpen set to false (mobile-first default)', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('toggleSidebar', () => {
    it('toggles sidebarOpen from false to true', () => {
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('toggles sidebarOpen from true to false', () => {
      useUIStore.setState({ sidebarOpen: true });
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });

    it('toggles back and forth', () => {
      useUIStore.getState().toggleSidebar();
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('setSidebarOpen', () => {
    it('sets sidebarOpen to false', () => {
      useUIStore.getState().setSidebarOpen(false);
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });

    it('sets sidebarOpen to true', () => {
      useUIStore.setState({ sidebarOpen: false });
      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('is idempotent when setting same value', () => {
      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });
  });
});
