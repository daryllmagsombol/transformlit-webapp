import { act, render, screen } from '@testing-library/react';
import { useWritePermit, resetWritePermitCacheForTests } from './use-write-permit';
import type { WritePermit } from '../offline/contracts';

let permit: WritePermit = { permitted: false, reason: 'NO_OWNER' };
let version = 0;
const listeners = new Set<() => void>();
const mockLifecycle = {
  writePermit: () => permit,
  stateVersion: () => version,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

jest.mock('../offline/account-activation', () => ({
  accountLifecycle: () => mockLifecycle,
}));

function setPermit(next: WritePermit) {
  permit = next;
  version += 1;
  for (const listener of listeners) listener();
}

function Probe() {
  const value = useWritePermit();
  return <span data-testid="permit">{value.permitted ? 'yes' : 'no'}</span>;
}

describe('useWritePermit', () => {
  beforeEach(() => {
    permit = { permitted: false, reason: 'NO_OWNER' };
    version = 0;
    listeners.clear();
    resetWritePermitCacheForTests();
  });

  it('reflects the initial permit', () => {
    render(<Probe />);
    expect(screen.getByTestId('permit')).toHaveTextContent('no');
  });

  it('re-renders when the lifecycle is asynchronously activated', () => {
    render(<Probe />);
    expect(screen.getByTestId('permit')).toHaveTextContent('no');

    act(() => {
      setPermit({ permitted: true, owner: { subject: 'subject-a', epoch: 1 } });
    });

    expect(screen.getByTestId('permit')).toHaveTextContent('yes');
  });
});
