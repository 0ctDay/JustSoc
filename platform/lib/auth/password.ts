import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth/config';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function normalizeUsername(input: unknown) {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

export function validateUsername(input: unknown) {
  const value = normalizeUsername(input);
  if (!value) throw new Error('用户名不能为空');
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/.test(value)) {
    throw new Error('用户名需以字母开头，仅支持字母、数字、点、下划线和中划线，长度 3-32');
  }
  return value;
}

export function validateDisplayName(input: unknown) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) throw new Error('显示名称不能为空');
  if (value.length > 64) throw new Error('显示名称长度不能超过 64');
  return value;
}

export function validatePassword(input: unknown) {
  const value = typeof input === 'string' ? input : '';
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) {
    throw new Error(`密码长度不能少于 ${AUTH_PASSWORD_MIN_LENGTH} 位`);
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new Error('密码必须同时包含字母和数字');
  }
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string) {
  const [algorithm, salt, digest] = hash.split('$');
  if (algorithm !== 'scrypt' || !salt || !digest) {
    return false;
  }

  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  const digestBytes = Buffer.from(digest, 'hex');
  if (digestBytes.length !== derived.length) return false;
  return timingSafeEqual(digestBytes, derived);
}