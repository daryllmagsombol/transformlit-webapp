'use client';

import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';

/* ------------------------------------------------------------------ */
/*  TextInput — reusable form field with label, icon, hint, error      */
/*  Mobile-first, uses design tokens, dark-mode compatible             */
/* ------------------------------------------------------------------ */

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label rendered above the input */
  label?: string;
  /** Error message rendered below the input */
  error?: string;
  /** Helper hint text shown below the input when no error */
  hint?: string;
  /** Optional icon rendered on the left side */
  icon?: ReactNode;
  /** Optional element rendered on the right side (e.g., show/hide toggle) */
  rightElement?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, error, hint, icon, rightElement, className = '', id, ...props }, ref) => {
    const inputId = id ?? props.name;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint && !error ? `${inputId}-hint` : undefined;
    const describedBy = errorId ?? hintId;

    return (
      <div className="space-y-2">
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className="block font-sans text-sm font-semibold text-ink ml-1"
          >
            {label}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Left icon */}
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/60 pointer-events-none">
              {icon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            className={[
              /* Base */
              'w-full h-11',
              'bg-surface border rounded-lg',
              'text-base',
              'placeholder:text-ink-soft/50',
              'outline-none transition-all duration-150',
              /* Icon spacing */
              icon ? 'pl-10' : 'pl-4',
              rightElement ? 'pr-10' : 'pr-4',
              /* Error state */
              error
                ? 'border-error focus:border-error focus:ring-2 focus:ring-error/20'
                : 'border-border hover:border-ink-soft/30 focus:border-brand focus:ring-2 focus:ring-brand/20',
              /* Allow consumer overrides */
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            {...props}
          />

          {/* Right element (e.g., password toggle) */}
          {rightElement && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {rightElement}
            </span>
          )}
        </div>

        {/* Hint text — shown only when no error */}
        {hint && !error && (
          <p id={hintId} className="text-xs text-ink-soft italic ml-1">
            {hint}
          </p>
        )}

        {/* Error message — rendered below the input */}
        {error && (
          <p id={errorId} className="text-xs text-error ml-1" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
TextInput.displayName = 'TextInput';
