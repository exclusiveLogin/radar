import type { ReactNode, SelectHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
};

const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: " ds-btn--primary",
  secondary: " ds-btn--secondary",
  ghost: " ds-btn--ghost",
  danger: " ds-btn--danger",
};

/** Кнопка действия для action-панелей админки. */
export function Button({
  children,
  onClick,
  type = "button",
  variant = "ghost",
  disabled = false,
  title,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`ds-btn${buttonVariantClass[variant]}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

type SelectOption = { value: string; label: string };

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: SelectOption[];
};

/** Выпадающий список (тонкая обёртка над <select> в стиле DS). */
export function Select({ options, ...rest }: SelectProps) {
  return (
    <select className="ds-select" {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type FieldProps = {
  label: string;
  /** Краткая подсказка под подписью — что меняет параметр. */
  hint?: string;
  children: ReactNode;
};

/** Подпись + контрол: вертикальная пара для форм. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="ds-field">
      <span className="ds-field__label">{label}</span>
      {hint ? <span className="ds-field__hint">{hint}</span> : null}
      {children}
    </label>
  );
}
