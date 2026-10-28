#!/usr/bin/env node
/**
 * Guarda de build: aborta si faltan las variables públicas de Supabase.
 *
 * Motivo (2026-10-28): un build sin VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * compila perfectamente y despliega una app muda. Ocurrió en producción: el
 * frontal se sirvió sin configuración y la única señal era un aviso en pantalla.
 * Fallar el build deja intacto el despliegue anterior, que es lo que se quiere.
 *
 * Revisa los ficheros .env igual que Vite (process.env tiene la última palabra),
 * así vale tanto en local —donde las claves viven en .env.local— como en Cloudflare.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const MODE = process.env.NODE_ENV === 'development' ? 'development' : 'production';

const candidates = ['.env', `.env.${MODE}`, '.env.local', `.env.${MODE}.local`];

const env = {};
for (const name of candidates) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) continue;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

for (const key of REQUIRED) {
  if (process.env[key] !== undefined && process.env[key] !== '') {
    env[key] = process.env[key];
  }
}

const missing = REQUIRED.filter((key) => !env[key]);
const blank = REQUIRED.filter((key) => env[key] !== undefined && env[key].trim() === '');
const problems = [...new Set([...missing, ...blank])];

if (problems.length > 0) {
  console.error(
    `\n[build] Faltan variables de Supabase: ${problems.join(', ')}.\n` +
      '[build] Se compilaría un frontal sin configuración. Build abortado a propósito.\n' +
      '[build] En local: revisa .env.local. En Cloudflare: Settings > Build > Build variables and secrets.\n'
  );
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL)) {
  console.error(
    `\n[build] VITE_SUPABASE_URL no parece una URL de proyecto: "${env.VITE_SUPABASE_URL}".\n` +
      '[build] Se esperaba https://<ref>.supabase.co\n'
  );
  process.exit(1);
}

console.log(`[build] Configuración de Supabase presente (${env.VITE_SUPABASE_URL}).`);
