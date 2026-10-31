/** Devuelve el primer setting de un texto ABC de TheSession, o null si no hay cabecera X:. */
export function firstSetting(abcText: string): string | null {
  const normalized = abcText.replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  
  let firstXIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('X:')) {
      firstXIndex = i;
      break;
    }
  }

  if (firstXIndex === -1) return null;

  let resultLines: string[] = [];
  for (let i = firstXIndex; i < lines.length; i++) {
    if (i > firstXIndex && lines[i].startsWith('X:')) {
      break;
    }
    resultLines.push(lines[i]);
  }

  const result = resultLines.join('\n');
  if (!result.trim()) return null;

  // Asegurar que termina en \n
  return result.endsWith('\n') ? result : result + '\n';
}

/** true si el ABC tiene las cinco cabeceras mínimas para reproducir. */
export function hasAbcHeader(abc: string): boolean {
  const required = ['X:', 'T:', 'M:', 'L:', 'K:'];
  const lines = abc.split('\n');
  
  for (const req of required) {
    const found = lines.some(line => line.trimStart().startsWith(req));
    if (!found) return false;
  }
  
  return true;
}
