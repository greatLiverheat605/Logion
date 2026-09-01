"use client";

import { type FormEvent, useState } from "react";

import { useVaultSession } from "@/features/offline/vault-session-provider";
import { PasswordField } from "@/features/auth/auth-form-shell";

interface PassphraseStepProps {
  onBack: () => void;
  onNext: () => void;
}

export function PassphraseStep({ onBack, onNext }: PassphraseStepProps) {
  const { unlock } = useVaultSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const passphrase = String(data.get("passphrase") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (passphrase !== confirmation) {
      setError("两次输入的本机口令不一致。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await unlock(passphrase);
      form.reset();
      onNext();
    } catch {
      setError("本机资料库未能设置或解锁，请检查口令后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="passphrase-setup-title"
      className="onboarding-step"
      data-testid="onboarding-step"
    >
      <header>
        <p className="eyebrow">STEP 4 · REQUIRED</p>
        <h1 id="passphrase-setup-title" tabIndex={-1}>
          设置本机数据口令
        </h1>
        <p>
          口令用于加密此设备上的离线资料，只写入本机加密资料库，不会写入
          localStorage 或发送到服务器。
        </p>
      </header>
      <form className="onboarding-form" onSubmit={savePassphrase}>
        <PasswordField
          autoComplete="new-password"
          disabled={pending}
          hint="至少 10 个字符，仅用于此设备的本地资料库。"
          id="onboarding-passphrase"
          label="本机口令"
          maxLength={256}
          minLength={10}
          name="passphrase"
          required
        />
        <PasswordField
          autoComplete="new-password"
          disabled={pending}
          id="onboarding-passphrase-confirmation"
          label="再次输入本机口令"
          maxLength={256}
          minLength={10}
          name="confirmation"
          required
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="onboarding-actions" data-testid="onboarding-recovery">
          <button
            className="secondary-button"
            disabled={pending}
            type="button"
            onClick={onBack}
          >
            上一步
          </button>
          <span>口令不会上传</span>
          <button
            className="primary-action"
            data-workbench-primary="true"
            disabled={pending}
            type="submit"
          >
            {pending ? "正在保护本机资料…" : "设置并继续"}
          </button>
        </div>
      </form>
    </section>
  );
}
