"use client";

import { type FormEvent, useState } from "react";

import { useVaultSession } from "@/features/offline/vault-session-provider";

interface PassphraseStepProps {
  onNext: () => void;
}

export function PassphraseStep({ onNext }: PassphraseStepProps) {
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
    >
      <header>
        <p className="eyebrow">STEP 4 · REQUIRED</p>
        <h1 id="passphrase-setup-title">设置本机数据口令</h1>
        <p>
          口令用于加密此设备上的离线资料，只写入本机加密资料库，不会写入
          localStorage 或发送到服务器。
        </p>
      </header>
      <form className="onboarding-form" onSubmit={savePassphrase}>
        <label htmlFor="onboarding-passphrase">
          本机口令
          <input
            autoComplete="new-password"
            disabled={pending}
            id="onboarding-passphrase"
            maxLength={256}
            minLength={10}
            name="passphrase"
            required
            type="password"
          />
        </label>
        <label htmlFor="onboarding-passphrase-confirmation">
          再次输入本机口令
          <input
            autoComplete="new-password"
            disabled={pending}
            id="onboarding-passphrase-confirmation"
            maxLength={256}
            minLength={10}
            name="confirmation"
            required
            type="password"
          />
        </label>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="onboarding-actions">
          <button className="primary-action" disabled={pending} type="submit">
            {pending ? "正在保护本机资料…" : "设置并继续"}
          </button>
        </div>
      </form>
    </section>
  );
}
