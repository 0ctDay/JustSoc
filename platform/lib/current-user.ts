export function resolveUserKey(headers: Headers) {
  return headers.get('x-justsoc-user')
    ?? headers.get('x-forwarded-user')
    ?? headers.get('x-remote-user')
    ?? process.env.SELK_DEFAULT_USER_KEY
    ?? 'default';
}
