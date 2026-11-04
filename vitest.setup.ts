/**
 * Entorno de pruebas: `localStorage` bajo jsdom.
 *
 * Node 26 trae *webstorage* propio y declara `localStorage` como propiedad de
 * `globalThis` (un getter que devuelve `undefined` si no se arranca con
 * `--experimental-webstorage`). `vitest` 2.1.9 copia las claves de jsdom sobre
 * el global **sin pisar las que ya existen**, así que el `Storage` de jsdom
 * nunca llega a las pruebas: `localStorage.clear()` revienta con «Cannot read
 * properties of undefined». `sessionStorage` sí cruza porque Node no lo declara
 * no enumerable como el otro, y ese detalle es el que despista.
 *
 * Aquí se repone un `Storage` en memoria, con la misma forma y el mismo
 * contrato, **solo si falta**. No sustituye a jsdom cuando jsdom funciona.
 */

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  } as Storage;
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
}
