'use client';
/**
 * Login details made by the super admin (client feedback 2026-11): the sign-in address, email and a
 * generated password, shown once. SampCode keeps only the password's hash, so it cannot be shown again;
 * make new ones if they are lost.
 */
import { useState } from 'react';
import { CopyField } from '@/components/Shell';

export interface LoginCredentials {
  loginUrl: string;
  email: string;
  password: string;
}

export function CredentialsCard({ credentials, who }: { credentials: LoginCredentials; who?: string }) {
  const [copied, setCopied] = useState(false);
  const all = `Sign in at: ${credentials.loginUrl}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`;
  return (
    <div className="stack sa-credentials" data-testid="login-credentials">
      <span className="small">
        <strong>Login details{who ? ` for ${who}` : ''}.</strong> Copy them now: the password is shown only once.
      </span>
      <CopyField label="Sign-in address" value={credentials.loginUrl} />
      <CopyField label="Login email" value={credentials.email} />
      <CopyField label="Password" value={credentials.password} />
      <div className="row">
        <button
          type="button"
          className="small"
          onClick={() =>
            void navigator.clipboard?.writeText(all).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'Copied' : 'Copy all login details'}
        </button>
      </div>
    </div>
  );
}

/** How a new account gets its first password. */
export function CredentialsChoice({ value, onChange }: { value: 'generate' | 'link'; onChange: (v: 'generate' | 'link') => void }) {
  return (
    <fieldset className="plain stack" style={{ gap: 4 }}>
      <legend className="small">Login details</legend>
      <label className="check small">
        <input type="radio" name="credentials" checked={value === 'generate'} onChange={() => onChange('generate')} /> Generate a password
        now and show me the login details to send
      </label>
      <label className="check small">
        <input type="radio" name="credentials" checked={value === 'link'} onChange={() => onChange('link')} /> Send a setup link so they
        choose their own password
      </label>
    </fieldset>
  );
}
