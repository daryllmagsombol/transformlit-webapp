import { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockedResponse } from '@apollo/client/testing';
import { ThemeProvider } from 'next-themes';

interface WrapperOptions {
  mocks?: MockedResponse[];
}

function createWrapper({ mocks = [] }: WrapperOptions = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MockedProvider mocks={mocks}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </MockedProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & WrapperOptions,
): RenderResult {
  const { mocks, ...renderOptions } = options ?? {};
  return render(ui, {
    wrapper: createWrapper({ mocks }),
    ...renderOptions,
  });
}

export { createWrapper };
