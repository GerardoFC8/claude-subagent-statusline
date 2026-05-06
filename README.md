**Español** | [English](./README.en.md)

# claude-subagent-statusline

Plugin para Claude Code que monitoriza las delegaciones a sub-agentes (Task) en tiempo real y muestra una statusline en vivo con el uso de la ventana de contexto, el conteo de delegaciones y el tiempo transcurrido de la sesión. Mantiene un historial persistente y consultable de cada delegación entre sesiones. Node.js puro (18 o superior) — funciona en Windows, macOS y Linux.

## Vista previa

```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s
```

La barra tiene 10 celdas y cambia de color según el porcentaje: verde por debajo del 50%, amarillo entre 50% y 79%, rojo a partir del 80%. Los segmentos `✗ failed` y `⏱` se muestran siempre — desde la primera invocación se ven `✗ 0 failed` y `⏱ 0s`.

## Instalación

```
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline
```

> **Reinicia Claude Code después de instalar.** El archivo `settings.json` no se recarga en caliente — los hooks del plugin no se activarán hasta que la aplicación se reinicie por completo.

## Configurar el statusLine

El plugin registra los hooks de seguimiento de forma automática, pero **no** modifica el campo `statusLine`. Hay que añadir este fragmento manualmente a `~/.claude/settings.json`:

```json
"statusLine": {
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js\""
}
```

En Windows, `${CLAUDE_PLUGIN_ROOT}` se expande a una ruta de Windows. Las barras hacia adelante funcionan; como alternativa se puede usar una ruta absoluta: `node "C:\\Users\\tu_usuario\\.claude\\plugins\\...\\scripts\\statusline.js"`.

> **Nota sobre la ruta**: `${CLAUDE_PLUGIN_ROOT}` es una variable de Claude Code que se resuelve en tiempo de ejecución. Después de ejecutar `claude plugin install`, comprueba dónde se instaló el plugin (suele estar en algún subdirectorio de `~/.claude/plugins/`) y sustituye el nombre real del directorio si la variable no está disponible. Si quieres una referencia estable que sobreviva a las actualizaciones del plugin, copia `scripts/statusline.js` a una ubicación fija y haz que `settings.json` apunte directamente allí.

## Instalación en Windows

1. Instala Node.js 18 o superior desde [nodejs.org](https://nodejs.org/). Se recomienda la versión LTS.
2. Instala el plugin:
   ```
   claude plugin marketplace add GerardoFC8/claude-subagent-statusline
   claude plugin install claude-subagent-statusline
   ```
3. Reinicia Claude Code.
4. Edita `~/.claude/settings.json` y establece `statusLine.command` con el formato `node` indicado más arriba.

No se necesita WSL, MSYS2 ni ninguna emulación de shell. El plugin es Node.js puro.

## Coexistencia con otro statusLine

Si ya tienes otro renderizador de statusLine, puedes leer el estado de las delegaciones desde el archivo JSONL y añadir los contadores a tu salida actual. El archivo de contadores está en `~/.claude/state/delegations-<session_id>.jsonl`. Cada entrada contiene los campos `id`, `status` (`running` | `done` | `failed`) y `started`. Contar identificadores únicos da los totales de en ejecución, completadas y fallidas.

## Historial persistente de delegaciones

Cada delegación de Task se registra en un archivo JSONL global con el prompt completo, los metadatos, el resultado y el texto de respuesta del sub-agente (truncado a 16 KB). El archivo tiene un tope de 500 entradas (buffer circular) y persiste entre sesiones.

Ubicación por defecto: `~/.claude/state/delegation-history.jsonl`
Ubicación personalizada: define `CLAUDE_PLUGIN_DATA=/tu/directorio` — el plugin escribirá en `$CLAUDE_PLUGIN_DATA/history.jsonl`.

## Aviso de privacidad

El archivo de historial guarda el **prompt completo** y el **texto de respuesta del sub-agente** (truncado a 16 KB) de cada delegación. Si tus prompts o las respuestas contienen información sensible, revisa el archivo antes de compartirlo o subirlo a un repositorio. El archivo es local de tu máquina y este plugin no lo envía a ningún sitio.

## Cómo funciona

1. **PreToolUse** se dispara cuando Claude Code lanza una delegación de Task — el hook añade una entrada `"running"` al archivo de contadores de la sesión Y una entrada completa (incluyendo el prompt completo) al archivo de historial global.
2. **PostToolUse** se dispara cuando la tarea termina — el hook añade una entrada `"done"` tanto al archivo de contadores como al historial (con métricas de coste y de tokens).
3. **PostToolUseFailure** se dispara cuando la tarea falla — el hook añade una entrada `"failed"` a ambos archivos (las métricas son nulas porque los payloads de fallo no transportan datos de coste de forma fiable).
4. **`statusline.js`** lee el JSONL de contadores de la sesión, cuenta los identificadores únicos en ejecución / completados / fallidos, calcula el tiempo transcurrido a partir de la entrada `started` más antigua, construye la barra de progreso a partir del porcentaje de la ventana de contexto e imprime la línea formateada en stdout.

Todos los pasos son sin estado y solo añaden contenido — sin daemons, sin bloqueos, sin ediciones in situ. El archivo de historial se recorta de forma atómica (archivo temporal + rename) cuando supera las 600 líneas, conservando las últimas 500.

## Solución de problemas

**Los hooks no se disparan / los contadores se quedan en 0**
Reinicia Claude Code. Los hooks se registran al arrancar; una instancia en ejecución no detecta plugins recién instalados.

**El archivo JSONL no aparece en `~/.claude/state/`**
Verifica que el directorio existe y se puede escribir. Si no existe, créalo:

- Linux/macOS: `mkdir -p ~/.claude/state`
- Windows (PowerShell): `New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\state"`

**Los contadores muestran valores raros**
Inspecciona el JSONL crudo de la sesión actual. Cada delegación genera dos líneas: una con `"status":"running"` (de PreToolUse) y otra con `"status":"done"` o `"status":"failed"` (de PostToolUse o PostToolUseFailure). Si solo ves líneas `running`, puede que el hook PostToolUse aún no se haya disparado o que la tarea todavía esté en curso.

## Limitaciones conocidas

**Condición de carrera al añadir al JSONL en Windows (poco frecuente)**
`fs.appendFileSync` no es atómico entre procesos concurrentes en Windows. Si dos invocaciones de hook se disparan simultáneamente para delegaciones distintas, las líneas del JSONL podrían entrelazarse. En la práctica es muy rara porque las delegaciones de Task se lanzan de forma secuencial. Si ocurre, las líneas afectadas producirán un error de parseo JSON en la statusline (que se ignora silenciosamente) y el historial tendrá una entrada corrupta que se descarta sin efectos.

## Contribuir

```bash
git clone https://github.com/GerardoFC8/claude-subagent-statusline.git
cd claude-subagent-statusline

# Requiere Node.js 18 o superior
node --version   # debe ser >= 18

# Ejecuta toda la suite de tests
npm test
```

Antes de fusionar cualquier cambio, todos los scripts deben pasar `npm test` (75 tests) sin ningún fallo. La CI ejecuta la matriz completa en Ubuntu, macOS y Windows en cada push.

## Licencia

MIT — consulta [LICENSE](LICENSE).
