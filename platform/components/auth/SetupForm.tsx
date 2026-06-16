'use client';

import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import SectionCard from '@/components/SectionCard';

export default function SetupForm() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [displayName, setDisplayName] = useState('系统管理员');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          displayName,
          password,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(String(payload.message ?? '初始化失败'));
        return;
      }

      router.push('/overview');
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '初始化失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page auth-page">
      <header className="page-header auth-header">
        <h1 className="page-title">初始化管理员</h1>
        <p className="page-description">平台首次启动时必须先创建首个管理员账号。</p>
      </header>

      <SectionCard title="首个管理员" description="初始化完成后会自动创建会话并进入平台。">
        <form className="settings-form auth-form" onSubmit={handleSubmit}>
          <div className="field-grid two">
            <label className="settings-field">
              <span className="field-section-title">用户名</span>
              <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" />
            </label>
            <label className="settings-field">
              <span className="field-section-title">显示名称</span>
              <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="系统管理员" />
            </label>
          </div>

          <div className="field-grid two">
            <label className="settings-field">
              <span className="field-section-title">密码</span>
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="不少于 10 位，包含字母和数字" />
            </label>
            <label className="settings-field">
              <span className="field-section-title">确认密码</span>
              <input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" />
            </label>
          </div>

          {error ? <div className="status-inline status-inline-error">{error}</div> : null}

          <div className="toolbar-group">
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? '初始化中...' : '创建管理员并进入平台'}
            </button>
          </div>
        </form>
      </SectionCard>
    </section>
  );
}