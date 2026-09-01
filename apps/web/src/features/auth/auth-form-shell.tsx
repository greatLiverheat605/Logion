"use client";

import {
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { AccessShellHeader } from "@/components/app-shell/access-shell-header";
import { AppIcon } from "@/components/app-shell/app-icon";

export function AuthFormShell({
  children,
  description,
  eyebrow = "LOGION ACCESS",
  identityTestId,
  title,
}: Readonly<{
  children: ReactNode;
  description: string;
  eyebrow?: string;
  identityTestId?: string;
  title: string;
}>) {
  return (
    <main id="main-content" className="auth-page public-flow-page">
      <div className="access-shell">
        <AccessShellHeader minimal />
        <div className="public-flow-stage">
          <section
            className="auth-card public-flow-panel"
            aria-describedby="auth-description"
            aria-labelledby="auth-title"
          >
            <header className="auth-heading" data-testid={identityTestId}>
              <p className="auth-kicker">{eyebrow}</p>
              <h1 id="auth-title">{title}</h1>
              <p id="auth-description">{description}</p>
            </header>
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}

export function FormError({
  message = "操作未完成，请检查输入或稍后重试。",
  requestId,
}: Readonly<{ message?: string; requestId: string }>) {
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messageRef.current?.focus();
  }, []);

  return (
    <div
      className="form-message form-error"
      ref={messageRef}
      role="alert"
      tabIndex={-1}
    >
      <p>{message}</p>
      <p>
        请求编号：<code>{requestId}</code>
      </p>
    </div>
  );
}

export function FormSuccess({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="form-message form-success" role="status">
      {children}
    </div>
  );
}

type PasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> & {
  hint?: string;
  id: string;
  label: string;
};

export function PasswordField({
  disabled,
  hint,
  id,
  label,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password-control">
        <input
          {...inputProps}
          disabled={disabled}
          id={id}
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-pressed={visible}
          className="auth-password-toggle"
          disabled={disabled}
          title={`${visible ? "隐藏" : "显示"}${label}`}
          type="button"
          onClick={() => setVisible((current) => !current)}
        >
          <AppIcon name={visible ? "eye-off" : "eye"} size={16} />
        </button>
      </div>
      {hint ? <p className="auth-field-hint">{hint}</p> : null}
    </div>
  );
}
