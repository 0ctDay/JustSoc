'use client';

import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function SessionMenu({
  displayName,
  username,
  roles,
}: {
  displayName: string;
  username: string;
  roles: string[];
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutSubmitting, setLogoutSubmitting] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  async function handleLogout() {
    try {
      setLogoutSubmitting(true);
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } finally {
      router.push('/login');
      router.refresh();
      setLogoutSubmitting(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    try {
      setPasswordSubmitting(true);
      setError('');
      setMessage('');
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(String(payload.message ?? '修改密码失败'));
        return;
      }

      setMessage('密码已修改');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      window.setTimeout(() => {
        setPasswordModalOpen(false);
        setMessage('');
      }, 800);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '修改密码失败');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <>
      <div ref={rootRef} className="auth-session-menu">
        <button
          className="auth-session-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <strong>{username}</strong>
          <span className={`auth-session-trigger-caret${menuOpen ? ' auth-session-trigger-caret-open' : ''}`} aria-hidden="true">▾</span>
        </button>

        {menuOpen ? (
          <div className="auth-session-popover" role="menu">
            <div className="auth-session-popover-header">
              <strong>{displayName}</strong>
              <span className="muted">{username}</span>
            </div>

            <div className="auth-session-permissions">
              <div className="auth-session-permissions-title">角色</div>
              <div className="auth-session-permissions-list">
                {roles.length ? roles.map((role) => (
                  <span className="auth-session-permission-chip" key={role}>{role}</span>
                )) : <span className="muted">暂无角色</span>}
              </div>
            </div>

            <button
              className="auth-session-popover-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setPasswordModalOpen(true);
                setError('');
                setMessage('');
              }}
            >
              修改密码
            </button>
            <button
              className="auth-session-popover-item auth-session-popover-item-danger"
              type="button"
              role="menuitem"
              disabled={logoutSubmitting}
              onClick={() => {
                setMenuOpen(false);
                void handleLogout();
              }}
            >
              {logoutSubmitting ? '退出中...' : '退出登录'}
            </button>
          </div>
        ) : null}
      </div>

      {passwordModalOpen ? (
        <div className="modal-backdrop" onClick={() => !passwordSubmitting && setPasswordModalOpen(false)} role="presentation">
          <div className="modal-window auth-password-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">修改密码</div>
                <div className="muted">{username}</div>
              </div>
              <button className="button" type="button" onClick={() => setPasswordModalOpen(false)}>关闭</button>
            </div>

            <form className="settings-form" onSubmit={handleChangePassword}>
              <label className="settings-field">
                <span className="field-section-title">当前密码</span>
                <input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </label>
              <label className="settings-field">
                <span className="field-section-title">新密码</span>
                <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="不少于 10 位，且包含字母和数字" />
              </label>
              <label className="settings-field">
                <span className="field-section-title">确认新密码</span>
                <input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>

              {error ? <div className="status-inline status-inline-error">{error}</div> : null}
              {message ? <div className="status-inline status-inline-success">{message}</div> : null}

              <div className="toolbar-group">
                <button className="button button-primary" type="submit" disabled={passwordSubmitting}>
                  {passwordSubmitting ? '提交中...' : '保存新密码'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}