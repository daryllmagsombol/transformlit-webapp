"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type FieldWrapperProps = {
  id?: string;
  label?: ReactNode;
  error?: string;
  helperText?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

function FieldWrapper({
  id,
  label,
  error,
  helperText,
  required,
  className,
  children,
}: FieldWrapperProps) {
  return (
    <div className={className}>
      {label ? (
        <label className="mb-2 block text-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p
          id={id ? `${id}-error` : undefined}
          className="mt-2 text-xs font-medium text-red-600"
        >
          {error}
        </p>
      ) : null}
      {!error && helperText ? (
        <p className="mt-2 text-xs text-ink-soft">{helperText}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-2xl border border-ink/10 bg-paper px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink-soft focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-60";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  error?: string;
  helperText?: ReactNode;
  className?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className, required, id, ...props },
  ref,
) {
  const inputId = id ?? props.name;

  return (
    <FieldWrapper
      id={inputId}
      label={label}
      error={error}
      helperText={helperText}
      required={required}
      className={className}
    >
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={controlBase}
        {...props}
      />
    </FieldWrapper>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  error?: string;
  helperText?: ReactNode;
  className?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, error, helperText, className, required, id, ...props },
    ref,
  ) {
    const textareaId = id ?? props.name;

    return (
      <FieldWrapper
        id={textareaId}
        label={label}
        error={error}
        helperText={helperText}
        required={required}
        className={className}
      >
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${textareaId}-error` : undefined}
          className={`${controlBase} min-h-30 resize-y`}
          {...props}
        />
      </FieldWrapper>
    );
  },
);

export type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: string;
  helperText?: ReactNode;
  options: SelectOption[];
  placeholderOption?: string;
  className?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      error,
      helperText,
      options,
      placeholderOption,
      className,
      required,
      id,
      ...props
    },
    ref,
  ) {
    const selectId = id ?? props.name;

    return (
      <FieldWrapper
        id={selectId}
        label={label}
        error={error}
        helperText={helperText}
        required={required}
        className={className}
      >
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${selectId}-error` : undefined}
          className={controlBase}
          {...props}
        >
          {placeholderOption ? (
            <option value="">{placeholderOption}</option>
          ) : null}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      </FieldWrapper>
    );
  },
);

export type ButtonVariant = "primary" | "secondary" | "outline" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-ink bg-brand text-ink hover:bg-brand-dark",
  secondary: "border-ink bg-paper text-ink hover:bg-ink hover:text-paper",
  outline: "border-ink/20 bg-paper text-ink hover:bg-ink hover:text-paper",
  destructive: "border-red-600 bg-red-600 text-white hover:bg-red-700",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-xs",
  md: "px-5 py-3 text-sm",
  lg: "px-6 py-3.5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading,
      fullWidth,
      className,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-full border-2 font-semibold transition focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-60",
          variantClasses[variant],
          sizeClasses[size],
          fullWidth ? "w-full" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {loading ? "Loading..." : children}
      </button>
    );
  },
);
