'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/SectionCard';
import StatusPanel from '@/components/StatusPanel';

type PermissionRecord = {
  code: string;
  name: string;
  description: string;
};

type RoleRecord = {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
};

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

type ManagementPayload = {
  users: UserRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
};

type AccessTab = 'users' | 'roles';
type UserModalTab = 'profile' | 'roles' | 'security';
type RoleModalTab = 'profile' | 'permissions';

const PERMISSION_GROUP_LABELS: Record<string, string> = {
  workspace: '工作台访问',
  ai: 'AI 研判',
  investigation: '调查任务',
  settings: '系统设置',
  runtime: '运行控制',
  bridge: 'Bridge 能力',
  rbac: '账号权限',
};

const PERMISSION_GROUP_ORDER = ['workspace', 'ai', 'investigation', 'settings', 'runtime', 'bridge', 'rbac'];

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload as T;
}

function formatDate(value?: string) {
  if (!value) return '暂无';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function toggleStringValue(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function groupPermissions(permissions: PermissionRecord[]) {
  const grouped = new Map<string, PermissionRecord[]>();
  permissions.forEach((permission) => {
    const key = permission.code.split(':')[0] || 'other';
    const current = grouped.get(key) ?? [];
    current.push(permission);
    grouped.set(key, current);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      const leftIndex = PERMISSION_GROUP_ORDER.indexOf(left);
      const rightIndex = PERMISSION_GROUP_ORDER.indexOf(right);
      return (leftIndex >= 0 ? leftIndex : 999) - (rightIndex >= 0 ? rightIndex : 999);
    })
    .map(([key, items]) => ({
      key,
      label: PERMISSION_GROUP_LABELS[key] ?? key,
      items,
    }));
}

export default function AccessManagementConsole() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [data, setData] = useState<ManagementPayload | null>(null);

  const [activeTab, setActiveTab] = useState<AccessTab>('users');
  const [userQuery, setUserQuery] = useState('');
  const [roleQuery, setRoleQuery] = useState('');

  const [userCreateOpen, setUserCreateOpen] = useState(false);
  const [userManageOpen, setUserManageOpen] = useState(false);
  const [roleManageOpen, setRoleManageOpen] = useState(false);
  const [userModalTab, setUserModalTab] = useState<UserModalTab>('profile');
  const [roleModalTab, setRoleModalTab] = useState<RoleModalTab>('profile');
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingRoleCode, setEditingRoleCode] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  const [newUser, setNewUser] = useState({
    username: '',
    displayName: '',
    password: '',
    roles: ['viewer'],
    isActive: true,
    mustChangePassword: false,
  });

  const [userForm, setUserForm] = useState({
    displayName: '',
    password: '',
    roles: [] as string[],
    isActive: true,
    mustChangePassword: false,
  });

  const [roleForm, setRoleForm] = useState({
    code: '',
    name: '',
    description: '',
    permissions: ['workspace:view'] as string[],
  });

  const selectedUser = useMemo(
    () => data?.users.find((item) => item.id === editingUserId) ?? null,
    [data?.users, editingUserId],
  );
  const selectedRole = useMemo(
    () => data?.roles.find((item) => item.code === editingRoleCode) ?? null,
    [data?.roles, editingRoleCode],
  );
  const filteredUsers = useMemo(() => {
    const keyword = userQuery.trim().toLowerCase();
    if (!keyword || !data) return data?.users ?? [];
    return data.users.filter((user) =>
      user.username.toLowerCase().includes(keyword)
      || user.displayName.toLowerCase().includes(keyword)
      || user.roles.some((role) => role.toLowerCase().includes(keyword)),
    );
  }, [data, userQuery]);
  const filteredRoles = useMemo(() => {
    const keyword = roleQuery.trim().toLowerCase();
    if (!keyword || !data) return data?.roles ?? [];
    return data.roles.filter((role) =>
      role.code.toLowerCase().includes(keyword)
      || role.name.toLowerCase().includes(keyword)
      || role.description.toLowerCase().includes(keyword),
    );
  }, [data, roleQuery]);
  const liveUserRoles = useMemo(() => {
    if (!data) return [];
    return data.roles.filter((role) => userForm.roles.includes(role.code));
  }, [data, userForm.roles]);
  const permissionGroups = useMemo(() => groupPermissions(data?.permissions ?? []), [data?.permissions]);

  useEffect(() => {
    void loadManagement();
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    setUserForm({
      displayName: selectedUser.displayName,
      password: '',
      roles: selectedUser.roles,
      isActive: selectedUser.isActive,
      mustChangePassword: selectedUser.mustChangePassword,
    });
    setUserModalTab('profile');
    setPasswordResetOpen(false);
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleForm({
      code: selectedRole.code,
      name: selectedRole.name,
      description: selectedRole.description,
      permissions: selectedRole.permissions,
    });
    setRoleModalTab('profile');
  }, [selectedRole]);

  async function loadManagement() {
    try {
      setLoading(true);
      setError('');
      const payload = await fetchJson<ManagementPayload>('/api/access/management');
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载权限管理数据失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setCreatingUser(true);
      setError('');
      setSuccess('');
      await fetchJson('/api/access/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setNewUser({
        username: '',
        displayName: '',
        password: '',
        roles: ['viewer'],
        isActive: true,
        mustChangePassword: false,
      });
      setUserCreateOpen(false);
      setSuccess('用户已创建');
      await loadManagement();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建用户失败');
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;

    try {
      setSavingUser(true);
      setError('');
      setSuccess('');
      await fetchJson(`/api/access/users/${encodeURIComponent(selectedUser.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...userForm,
          password: passwordResetOpen ? userForm.password : '',
        }),
      });
      setUserManageOpen(false);
      setSuccess(`用户 ${selectedUser.username} 已更新`);
      await loadManagement();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '更新用户失败');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleSaveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingRole(true);
      setError('');
      setSuccess('');
      const method = selectedRole ? 'PATCH' : 'POST';
      const target = selectedRole ? `/api/access/roles/${encodeURIComponent(selectedRole.code)}` : '/api/access/roles';
      await fetchJson(target, {
        method,
        body: JSON.stringify(roleForm),
      });
      setRoleManageOpen(false);
      setSuccess(selectedRole ? `角色 ${selectedRole.code} 已更新` : `角色 ${roleForm.code} 已创建`);
      await loadManagement();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存角色失败');
    } finally {
      setSavingRole(false);
    }
  }

  if (loading) {
    return <StatusPanel title="权限管理加载中" description="正在读取用户、角色和权限配置。" />;
  }

  if (!data) {
    return <StatusPanel title="权限管理加载失败" description={error || '未拿到权限管理数据'} tone="error" />;
  }

  return (
    <section className="page access-page">
      <header className="page-header">
        <h1 className="page-title">账号与权限</h1>
      </header>

      {error ? <div className="status-inline status-inline-error">{error}</div> : null}
      {success ? <div className="status-inline status-inline-success">{success}</div> : null}

      <div className="access-tabbar">
        <button className={`button${activeTab === 'users' ? ' button-primary' : ''}`} type="button" onClick={() => setActiveTab('users')}>用户管理</button>
        <button className={`button${activeTab === 'roles' ? ' button-primary' : ''}`} type="button" onClick={() => setActiveTab('roles')}>角色权限</button>
      </div>

      {activeTab === 'users' ? (
        <SectionCard
          title="所有用户"
          actions={(
            <div className="access-table-toolbar">
              <input className="input access-table-search" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="筛选用户" />
              <button className="button button-primary" type="button" onClick={() => setUserCreateOpen(true)}>新建用户</button>
            </div>
          )}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>显示名称</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>最后登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.displayName}</td>
                    <td>{user.roles.join('、') || '未分配'}</td>
                    <td>{user.isActive ? '启用' : '停用'}</td>
                    <td>{formatDate(user.lastLoginAt)}</td>
                    <td>
                      <button
                        className="button access-manage-button"
                        type="button"
                        onClick={() => {
                          setEditingUserId(user.id);
                          setUserManageOpen(true);
                        }}
                      >
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title="所有角色"
          actions={(
            <div className="access-table-toolbar">
              <input className="input access-table-search" value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} placeholder="筛选角色" />
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  setEditingRoleCode(null);
                  setRoleForm({
                    code: '',
                    name: '',
                    description: '',
                    permissions: ['workspace:view'],
                  });
                  setRoleManageOpen(true);
                }}
              >
                新建角色
              </button>
            </div>
          )}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>编码</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>权限数</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map((role) => (
                  <tr key={role.code}>
                    <td>{role.code}</td>
                    <td>{role.name}</td>
                    <td>{role.isSystem ? '系统' : '自定义'}</td>
                    <td>{role.permissions.length}</td>
                    <td>{formatDate(role.updatedAt)}</td>
                    <td>
                      <button
                        className="button access-manage-button"
                        type="button"
                        onClick={() => {
                          setEditingRoleCode(role.code);
                          setRoleManageOpen(true);
                        }}
                      >
                        管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {userCreateOpen ? (
        <div className="modal-backdrop" onClick={() => !creatingUser && setUserCreateOpen(false)} role="presentation">
          <div className="modal-window access-modal-window" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div className="modal-title">新建用户</div>
              <button className="button" type="button" onClick={() => setUserCreateOpen(false)}>关闭</button>
            </div>
            <form className="settings-form" onSubmit={handleCreateUser}>
              <label className="settings-field">
                <span className="field-section-title">用户名</span>
                <input className="input" value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} />
              </label>
              <label className="settings-field">
                <span className="field-section-title">显示名称</span>
                <input className="input" value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} />
              </label>
              <label className="settings-field">
                <span className="field-section-title">初始密码</span>
                <input className="input" type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
              </label>
              <div className="access-toggle-grid">
                <label className="check-card">
                  <input type="checkbox" checked={newUser.isActive} onChange={(event) => setNewUser((current) => ({ ...current, isActive: event.target.checked }))} />
                  <span>启用账号</span>
                </label>
                <label className="check-card">
                  <input type="checkbox" checked={newUser.mustChangePassword} onChange={(event) => setNewUser((current) => ({ ...current, mustChangePassword: event.target.checked }))} />
                  <span>首次登录强制改密</span>
                </label>
              </div>
              <div className="access-choice-grid">
                {data.roles.map((role) => (
                  <label className={`access-choice-card${newUser.roles.includes(role.code) ? ' access-choice-card-active' : ''}`} key={role.code}>
                    <input
                      type="checkbox"
                      checked={newUser.roles.includes(role.code)}
                      onChange={() => setNewUser((current) => ({ ...current, roles: toggleStringValue(current.roles, role.code) }))}
                    />
                    <div>
                      <div className="access-choice-title">{role.name}</div>
                      <div className="access-choice-meta">{role.code}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="toolbar-group">
                <button className="button button-primary" type="submit" disabled={creatingUser}>
                  {creatingUser ? '创建中...' : '创建用户'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {userManageOpen && selectedUser ? (
        <div className="modal-backdrop" onClick={() => !savingUser && setUserManageOpen(false)} role="presentation">
          <div className="modal-window access-modal-window" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="modal-title">{selectedUser.displayName}</div>
                <div className="muted">{selectedUser.username}</div>
              </div>
              <button className="button" type="button" onClick={() => setUserManageOpen(false)}>关闭</button>
            </div>

            <form className="settings-form" onSubmit={handleUpdateUser}>
              <div className="access-editor-tabs">
                <button className={`access-editor-tab${userModalTab === 'profile' ? ' access-editor-tab-active' : ''}`} type="button" onClick={() => setUserModalTab('profile')}>基本信息</button>
                <button className={`access-editor-tab${userModalTab === 'roles' ? ' access-editor-tab-active' : ''}`} type="button" onClick={() => setUserModalTab('roles')}>角色权限</button>
                <button className={`access-editor-tab${userModalTab === 'security' ? ' access-editor-tab-active' : ''}`} type="button" onClick={() => setUserModalTab('security')}>安全设置</button>
              </div>

              {userModalTab === 'profile' ? (
                <div className="access-pane-grid">
                  <label className="settings-field">
                    <span className="field-section-title">用户名</span>
                    <input className="input" value={selectedUser.username} disabled />
                  </label>
                  <label className="settings-field">
                    <span className="field-section-title">显示名称</span>
                    <input className="input" value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} />
                  </label>
                  <div className="access-info-card">
                    <span>创建时间</span>
                    <strong>{formatDate(selectedUser.createdAt)}</strong>
                  </div>
                  <div className="access-info-card">
                    <span>最后登录</span>
                    <strong>{formatDate(selectedUser.lastLoginAt)}</strong>
                  </div>
                </div>
              ) : null}

              {userModalTab === 'roles' ? (
                <div className="access-pane-stack">
                  <div className="access-choice-grid">
                    {data.roles.map((role) => (
                      <label className={`access-choice-card${userForm.roles.includes(role.code) ? ' access-choice-card-active' : ''}`} key={role.code}>
                        <input
                          type="checkbox"
                          checked={userForm.roles.includes(role.code)}
                          onChange={() => setUserForm((current) => ({ ...current, roles: toggleStringValue(current.roles, role.code) }))}
                        />
                        <div>
                          <div className="access-choice-title">{role.name}</div>
                          <div className="access-choice-meta">{role.code}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="access-selection-strip">
                    {liveUserRoles.map((role) => (
                      <span className="status-pill status-gray" key={role.code}>{role.name}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {userModalTab === 'security' ? (
                <div className="access-pane-stack">
                  <div className="access-toggle-grid">
                    <label className="check-card">
                      <input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm((current) => ({ ...current, isActive: event.target.checked }))} />
                      <span>允许登录</span>
                    </label>
                    <label className="check-card">
                      <input type="checkbox" checked={userForm.mustChangePassword} onChange={(event) => setUserForm((current) => ({ ...current, mustChangePassword: event.target.checked }))} />
                      <span>下次登录强制改密</span>
                    </label>
                  </div>
                  <div className="access-password-card">
                    <div className="access-password-card-head">
                      <strong>重置密码</strong>
                      <button className="button" type="button" onClick={() => setPasswordResetOpen((current) => !current)}>
                        {passwordResetOpen ? '取消' : '设置新密码'}
                      </button>
                    </div>
                    {passwordResetOpen ? (
                      <label className="settings-field">
                        <span className="field-section-title">新密码</span>
                        <input className="input" type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} />
                      </label>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="access-savebar">
                <button className="button button-primary" type="submit" disabled={savingUser}>
                  {savingUser ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {roleManageOpen ? (
        <div className="modal-backdrop" onClick={() => !savingRole && setRoleManageOpen(false)} role="presentation">
          <div className="modal-window access-modal-window" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div className="modal-title">{selectedRole ? selectedRole.name : '新建角色'}</div>
              <button className="button" type="button" onClick={() => setRoleManageOpen(false)}>关闭</button>
            </div>

            <form className="settings-form" onSubmit={handleSaveRole}>
              <div className="access-editor-tabs">
                <button className={`access-editor-tab${roleModalTab === 'profile' ? ' access-editor-tab-active' : ''}`} type="button" onClick={() => setRoleModalTab('profile')}>基本信息</button>
                <button className={`access-editor-tab${roleModalTab === 'permissions' ? ' access-editor-tab-active' : ''}`} type="button" onClick={() => setRoleModalTab('permissions')}>权限分配</button>
              </div>

              {roleModalTab === 'profile' ? (
                <div className="access-pane-grid">
                  <label className="settings-field">
                    <span className="field-section-title">角色编码</span>
                    <input className="input" value={roleForm.code} disabled={Boolean(selectedRole)} onChange={(event) => setRoleForm((current) => ({ ...current, code: event.target.value }))} />
                  </label>
                  <label className="settings-field">
                    <span className="field-section-title">角色名称</span>
                    <input className="input" value={roleForm.name} disabled={selectedRole?.isSystem} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))} />
                  </label>
                  <label className="settings-field access-pane-span-2">
                    <span className="field-section-title">角色描述</span>
                    <input className="input" value={roleForm.description} disabled={selectedRole?.isSystem} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} />
                  </label>
                </div>
              ) : null}

              {roleModalTab === 'permissions' ? (
                <div className="access-pane-stack">
                  {permissionGroups.map((group) => (
                    <div className="access-permission-group" key={group.key}>
                      <div className="access-permission-group-head">
                        <strong>{group.label}</strong>
                        <span className="muted">{group.items.length} 项</span>
                      </div>
                      <div className="access-choice-grid">
                        {group.items.map((permission) => (
                          <label className={`access-choice-card access-permission-card${roleForm.permissions.includes(permission.code) ? ' access-choice-card-active' : ''}`} key={permission.code}>
                            <input
                              type="checkbox"
                              disabled={selectedRole?.isSystem}
                              checked={roleForm.permissions.includes(permission.code)}
                              onChange={() => setRoleForm((current) => ({ ...current, permissions: toggleStringValue(current.permissions, permission.code) }))}
                            />
                            <div>
                              <div className="access-choice-title">{permission.name}</div>
                              <div className="access-choice-meta">{permission.code}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedRole?.isSystem ? <div className="status-inline">系统角色不允许修改。</div> : null}

              <div className="access-savebar">
                <button className="button button-primary" type="submit" disabled={savingRole || selectedRole?.isSystem}>
                  {savingRole ? '保存中...' : selectedRole ? '保存修改' : '创建角色'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}