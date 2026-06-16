import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { alertFieldMappingSchema, defaultAlertFieldMappings, type AlertFieldMappingSchemaItem, type AlertFieldMappings } from '@/lib/alert-field-mapping-schema';

const CONFIG_PATH = path.join(process.cwd(), 'conf', 'alert-field-mappings.json');
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_.@-]+$/;

function serializeMappings(mappings: AlertFieldMappings) {
  return `${JSON.stringify(mappings, null, 2)}\n`;
}

async function ensureConfigFile() {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  try {
    await readFile(CONFIG_PATH, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await writeFile(CONFIG_PATH, serializeMappings(defaultAlertFieldMappings), 'utf-8');
  }
}

function requiresBaseFieldPath(item: AlertFieldMappingSchemaItem) {
  return item.aggregationFieldMode === 'keyword' || item.sortFieldMode === 'keyword' || item.queryFieldMode === 'keyword';
}

function normalizeFieldPath(value: unknown, item: AlertFieldMappingSchemaItem) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const candidate = trimmed || item.defaultValue;
  if (!candidate) {
    throw new Error(`${item.label}不能为空`);
  }
  if (!FIELD_PATH_PATTERN.test(candidate)) {
    throw new Error(`${item.label}格式不正确，仅支持字母、数字、点、下划线、连字符和 @`);
  }
  if (requiresBaseFieldPath(item) && candidate.endsWith('.keyword')) {
    throw new Error(`${item.label}请填写基础字段路径，不要直接填写 .keyword 子字段`);
  }
  return candidate;
}

export function normalizeAlertFieldMappings(input: Partial<AlertFieldMappings> | null | undefined): AlertFieldMappings {
  const normalized = alertFieldMappingSchema.reduce<AlertFieldMappings>((current, item) => {
    current[item.key] = normalizeFieldPath(input?.[item.key], item);
    return current;
  }, {} as AlertFieldMappings);

  const seen = new Map<string, string>();
  for (const item of alertFieldMappingSchema) {
    const value = normalized[item.key];
    const previousLabel = seen.get(value);
    if (previousLabel) {
      throw new Error(`${item.label}与${previousLabel}不能配置成同一个字段`);
    }
    seen.set(value, item.label);
  }

  return normalized;
}

export async function getAlertFieldMappings(): Promise<AlertFieldMappings> {
  await ensureConfigFile();
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AlertFieldMappings>;
    return normalizeAlertFieldMappings(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return defaultAlertFieldMappings;
    }
    throw error;
  }
}

export async function putAlertFieldMappings(input: Partial<AlertFieldMappings>): Promise<AlertFieldMappings> {
  await ensureConfigFile();
  const normalized = normalizeAlertFieldMappings(input);
  await writeFile(CONFIG_PATH, serializeMappings(normalized), 'utf-8');
  return normalized;
}

export function getAlertFieldMappingsConfigPath() {
  return CONFIG_PATH;
}