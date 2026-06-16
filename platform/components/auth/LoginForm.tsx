'use client';

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SectionCard from '@/components/SectionCard';
import SliderCaptcha, { type SliderCaptchaPayload } from '@/components/auth/SliderCaptcha';

type CaptchaVerifyResponse = {
  verified: true;
  verificationNonce: string;
  verificationExpiresAt: string;
};

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return {};
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const nextValue = searchParams.get('next');
    return nextValue && nextValue.startsWith('/') ? nextValue : '/overview';
  }, [searchParams]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState<SliderCaptchaPayload | null>(null);
  const [captchaOffset, setCaptchaOffset] = useState(0);
  const [captchaNonce, setCaptchaNonce] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaStatus, setCaptchaStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed'>('idle');
  const [captchaMessage, setCaptchaMessage] = useState('请完成滑块验证');
  const [captchaModalOpen, setCaptchaModalOpen] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function resetCaptchaState() {
    setCaptcha(null);
    setCaptchaOffset(0);
    setCaptchaNonce('');
    setCaptchaStatus('idle');
    setCaptchaMessage('请完成滑块验证');
  }

  async function loadCaptcha(openModal = false) {
    try {
      setCaptchaLoading(true);
      resetCaptchaState();
      setError('');

      const response = await fetch('/api/auth/captcha', { cache: 'no-store' });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '滑块验证码加载失败');
      }

      setCaptcha(payload as SliderCaptchaPayload);
      setCaptchaModalOpen(openModal);
    } catch (loadError) {
      setCaptchaStatus('failed');
      setCaptchaMessage(loadError instanceof Error ? loadError.message : '滑块验证码加载失败');
      if (openModal) {
        setCaptchaModalOpen(true);
      }
    } finally {
      setCaptchaLoading(false);
    }
  }

  async function submitLogin(overrideNonce?: string, overrideCaptchaId?: string) {
    const activeNonce = overrideNonce ?? captchaNonce;
    const activeCaptchaId = overrideCaptchaId ?? captcha?.captchaId;

    try {
      setSubmitting(true);
      setError('');

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
          captchaId: activeCaptchaId,
          captchaNonce: activeNonce,
        }),
      });

      const payload = await readJson(response) as { requiresSetup?: boolean; message?: string };
      if (!response.ok) {
        if (payload.requiresSetup) {
          router.push('/setup');
          router.refresh();
          return;
        }

        resetCaptchaState();
        setPendingLogin(false);
        setError(payload.message ?? '登录失败');
        return;
      }

      setPendingLogin(false);
      router.push(nextPath);
      router.refresh();
    } catch (submitError) {
      setPendingLogin(false);
      setError(submitError instanceof Error ? submitError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCaptcha(offset: number) {
    if (!captcha) return;

    try {
      setCaptchaStatus('verifying');
      setCaptchaMessage('正在校验滑块位置...');
      const response = await fetch('/api/auth/captcha/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          captchaId: captcha.captchaId,
          captchaOffset: offset,
        }),
      });

      const payload = await readJson(response) as { message?: string } & Partial<CaptchaVerifyResponse>;
      if (!response.ok || payload.verified !== true || !payload.verificationNonce) {
        setCaptchaNonce('');
        setCaptchaStatus('failed');
        setCaptchaMessage(payload.message ?? '滑块位置不正确，请重试');
        return;
      }

      setCaptchaNonce(payload.verificationNonce);
      setCaptchaStatus('verified');
      setCaptchaMessage('验证成功');

      await sleep(700);
      setCaptchaModalOpen(false);

      if (pendingLogin) {
        await submitLogin(payload.verificationNonce, captcha.captchaId);
      }
    } catch (verifyError) {
      setCaptchaNonce('');
      setCaptchaStatus('failed');
      setCaptchaMessage(verifyError instanceof Error ? verifyError.message : '滑块验证失败');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }

    if (!captchaNonce || !captcha || captchaStatus !== 'verified') {
      setPendingLogin(true);
      await loadCaptcha(true);
      return;
    }

    await submitLogin();
  }

  return (
    <section className="page auth-page">
      <SectionCard title="JustSoc" className="auth-login-card">
        <form className="settings-form auth-form auth-form-compact" onSubmit={handleSubmit}>
          <label className="settings-field">
            <span className="field-section-title">用户名</span>
            <input className="input" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label className="settings-field">
            <span className="field-section-title">密码</span>
            <input className="input" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>

          {error ? <div className="status-inline status-inline-error">{error}</div> : null}

          <button className="button button-primary auth-login-submit" type="submit" disabled={submitting}>
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>
      </SectionCard>

      {captchaModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (submitting || captchaLoading) return;
            setPendingLogin(false);
            setCaptchaModalOpen(false);
          }}
          role="presentation"
        >
          <div className="modal-window auth-captcha-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div className="modal-title">请完成验证</div>
              <div className="toolbar-group">
                <button className="button" type="button" disabled={submitting || captchaLoading} onClick={() => void loadCaptcha(true)}>
                  {captchaLoading ? '加载中...' : '刷新验证码'}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={submitting || captchaLoading}
                  onClick={() => {
                    setPendingLogin(false);
                    setCaptchaModalOpen(false);
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
            <SliderCaptcha
              challenge={captcha}
              value={captchaOffset}
              loading={captchaLoading}
              disabled={submitting}
              status={captchaStatus}
              message={captchaMessage}
              onChange={setCaptchaOffset}
              onVerify={verifyCaptcha}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}