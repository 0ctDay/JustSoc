export const AUTH_SESSION_COOKIE = 'selk_session';

export const AUTH_PERMISSION_DEFINITIONS = [
  {
    code: 'workspace:view',
    name: 'Workspace View',
    description: 'View overview, alerts, logs, assets, and related workspace APIs.',
  },
  {
    code: 'ai:analyze',
    name: 'AI Analyze',
    description: 'Use AI analysis and AI connectivity test endpoints.',
  },
  {
    code: 'investigation:manage',
    name: 'Investigation Manage',
    description: 'Create and manage investigation and agent tasks.',
  },
  {
    code: 'settings:manage',
    name: 'Settings Manage',
    description: 'Manage platform settings, bridge settings, and field mappings.',
  },
  {
    code: 'assets:view',
    name: 'Assets View',
    description: 'View dispatcher asset documents, publish records, and probe asset status.',
  },
  {
    code: 'assets:edit',
    name: 'Assets Edit',
    description: 'Create, update, and delete dispatcher asset YAML documents.',
  },
  {
    code: 'assets:publish',
    name: 'Assets Publish',
    description: 'Publish asset YAML documents to one or more probe-dispatcher targets.',
  },
  {
    code: 'runtime:restart',
    name: 'Runtime Restart',
    description: 'Restart probe or engine services through the runtime control API.',
  },
  {
    code: 'dispatcher:view',
    name: 'Dispatcher View',
    description: 'View probe-dispatcher targets, status, and recent publish results.',
  },
  {
    code: 'dispatcher:control',
    name: 'Dispatcher Control',
    description: 'Execute dispatcher-side control actions such as rollback or remote control operations.',
  },
  {
    code: 'dispatcher:credential:manage',
    name: 'Dispatcher Credential Manage',
    description: 'Manage probe-dispatcher target endpoints and machine credentials.',
  },
  {
    code: 'bridge:manage',
    name: 'Bridge Manage',
    description: 'Use Claude Code Bridge task and session capabilities.',
  },
  {
    code: 'rbac:manage',
    name: 'RBAC Manage',
    description: 'Manage users, roles, and role permissions.',
  },
] as const;

export type AuthPermissionCode = (typeof AUTH_PERMISSION_DEFINITIONS)[number]['code'];

export const AUTH_ROLE_DEFINITIONS = [
  {
    code: 'admin',
    name: 'Administrator',
    description: 'Full access to all platform capabilities.',
    isSystem: true,
    permissions: AUTH_PERMISSION_DEFINITIONS.map((item) => item.code),
  },
  {
    code: 'operator',
    name: 'Operator',
    description: 'Operate the platform, dispatcher targets, settings, and bridge features.',
    isSystem: true,
    permissions: [
      'workspace:view',
      'ai:analyze',
      'investigation:manage',
      'settings:manage',
      'assets:view',
      'assets:edit',
      'assets:publish',
      'runtime:restart',
      'dispatcher:view',
      'dispatcher:control',
      'dispatcher:credential:manage',
      'bridge:manage',
    ],
  },
  {
    code: 'analyst',
    name: 'Analyst',
    description: 'Investigate alerts, review assets, and use AI-assisted workflows.',
    isSystem: true,
    permissions: ['workspace:view', 'ai:analyze', 'investigation:manage', 'assets:view', 'dispatcher:view'],
  },
  {
    code: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to workspace content.',
    isSystem: true,
    permissions: ['workspace:view'],
  },
] as const;

export const AUTH_PUBLIC_PAGE_PATHS = ['/login', '/setup'];
export const AUTH_PUBLIC_API_PREFIXES = [
  '/api/auth/bootstrap-status',
  '/api/auth/bootstrap',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/captcha',
];

export const AUTH_PAGE_PERMISSION_RULES: Array<{ prefix: string; permission: AuthPermissionCode }> = [
  { prefix: '/settings', permission: 'settings:manage' },
  { prefix: '/access', permission: 'rbac:manage' },
];

export const AUTH_API_PERMISSION_RULES: Array<{ prefix: string; permission: AuthPermissionCode }> = [
  { prefix: '/api/settings', permission: 'settings:manage' },
  { prefix: '/api/runtime/restart', permission: 'runtime:restart' },
  { prefix: '/api/claude-bridge', permission: 'bridge:manage' },
  { prefix: '/api/ai/test', permission: 'settings:manage' },
  { prefix: '/api/ai/analyze-alert', permission: 'ai:analyze' },
  { prefix: '/api/access', permission: 'rbac:manage' },
];

export const AUTH_BRUTE_FORCE_WINDOW_MS = 30 * 60 * 1000;
export const AUTH_CAPTCHA_AFTER_FAILURES = 3;
export const AUTH_LOCK_AFTER_FAILURES = 6;
export const AUTH_CAPTCHA_TTL_MS = 10 * 60 * 1000;
export const AUTH_LOCK_TTL_MS = 15 * 60 * 1000;

export const AUTH_DEFAULT_SESSION_HOURS = Number(process.env.SELK_AUTH_SESSION_HOURS ?? '12');

export const AUTH_PASSWORD_MIN_LENGTH = 10;
