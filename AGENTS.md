# AGENTS.md — tradtracker

Instrucciones para agentes de IA (OpenCode, Claude Code, etc.) operando en este repo.

## Repositorio

- **Forgejo:** https://git.crivote.dedyn.io/crivote/tradtracker
- **Remote local:** `forgejo`
- **URL SSH:** git@forgejo-tradtracker:crivote/tradtracker.git

## Git — flujo estándar

Este repo usa Forgejo (self-hosted) como origin principal.
GitHub actúa como mirror de backup (push automático desde Forgejo).

```bash
git add -A
git commit -m "descripción del cambio"
git push forgejo main
```

## Autenticación SSH

- **Alias SSH:** `forgejo-tradtracker`
- **Clave privada:** `/home/victor/.ssh/forgejo_deploy_tradtracker`
- **Tipo:** deploy key con permiso de escritura (solo este repo)

La clave está configurada en `~/.ssh/config`. No se necesita especificar
puerto ni clave manualmente — el alias lo gestiona.

## Convenciones

- Commits en español o inglés, consistente dentro del proyecto
- Un commit por unidad lógica de cambio
- No commitear ficheros de configuración con credenciales
- `.env`, `*.toml` con secrets → añadir a `.gitignore`
