**Español** | [English](./README.en.md)

# claude-subagent-statusline

Plugin para Claude Code que muestra una statusline en vivo con la carpeta del proyecto, el modelo y effort activos, el costo estimado de la sesión, el uso de la ventana de contexto, los contadores de sub-agentes (Task) en tiempo real, el tiempo transcurrido y los rate limits de 5h y 7d. Mantiene además un historial persistente y consultable de cada delegación entre sesiones. Node.js puro (18 o superior) — funciona en Windows, macOS y Linux.

## Vista previa

```
my-app [Opus 4.7 (high) · $1.42] ████░░░░░░ 42% │ ⏱ 14m 32s │ ⚡ 2 · ✓ 7 · ✗ 0 │ 5h: 13% (reset in 1h 8m) · Week: 4% (reset in 5d 15h)
```

### Significado de los íconos

| Ícono | Qué significa |
|---|---|
| `⚡` | Sub-agentes (Tasks) **en ejecución** en este momento |
| `✓` | Sub-agentes **completados** con éxito |
| `✗` | Sub-agentes que **fallaron** |
| `⏱` | **Tiempo transcurrido** desde el inicio de la sesión |

### Cómo se construye cada segmento

**Carpeta del proyecto** (`my-app` en negrita al inicio) — basename de `workspace.current_dir`, con `cwd` como fallback. Si el directorio coincide con tu `$HOME`, se muestra como `~`. Si Claude Code no expone ninguno de los dos campos, el prefijo se omite. Útil para distinguir sesiones cuando tenés varias instancias abiertas en distintos repos.

**Bracket del modelo** (`[Opus 4.7 (high) · $1.42]`) — combina tres datos:
- *Nombre del modelo*: se obtiene parseando `model.id` (por ejemplo, `claude-opus-4-7` → `Opus 4.7`). Si el campo no está disponible, se cae al fallback `model.display_name` con anotaciones tipo `(1M context)` o `(200K context)` removidas para mantener el bracket compacto.
- *Effort level*: entre paréntesis después del modelo aparece el `effort.level` activo (`low`, `medium`, `high`, `xhigh` o `max`). Refleja cambios mid-sesión hechos con `/effort`. Si el modelo no soporta effort, se omite.
- *Costo estimado*: el sufijo `· $X.XX` muestra el costo total de la sesión en USD, calculado del lado del cliente por Claude Code. Acumula el costo del agente principal **y** todos los sub-agentes lanzados con Task. Si Claude Code no expone `cost`, el sufijo se omite.

**Barra de contexto** (`████░░░░░░ 42%`) — tiene 10 celdas y cambia de color según el porcentaje: verde por debajo del 50%, amarillo entre 50% y 79%, rojo a partir del 80%. Los contadores de sub-agentes (`⚡` `✓` `✗`) y el segmento `⏱` se muestran siempre, incluso cuando los valores son cero.

**Jerarquía de separadores** — la statusline usa dos tipos de separador con un significado distinto: `│` (barra pesada) marca **secciones** (bracket del modelo / barra y elapsed / contadores / rate limits), mientras que `·` (medio) separa **items dentro de una sección** (entre `⚡ ✓ ✗` y entre `5h` y `Week`).

**Rate limits** (`5h: X% (reset in …) · Week: X% (reset in …)`) — uso actual de los rate limits de 5 horas y 7 días reportados por Claude Code, junto con el tiempo restante hasta el próximo reset. El porcentaje se colorea con la misma escala que la barra (verde / amarillo / rojo) para que detectes a simple vista cuándo te estás acercando al límite. El delta de reset se formatea como `Xm` por debajo de una hora, `Xh Ym` por debajo de un día, o `Xd Yh` para ventanas más largas. Si tu cuenta no expone rate limits, el segmento se omite entero.

## Instalación

```
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline@claude-subagent-statusline
```

> **Reinicia Claude Code después de instalar.** El archivo `settings.json` no se recarga en caliente — los hooks del plugin no se activarán hasta que la aplicación se reinicie por completo.

## Actualizar a la última versión

Si ya tenés el plugin instalado y querés traer la versión más reciente:

```
claude plugin update claude-subagent-statusline@claude-subagent-statusline
```

**Reinicia Claude Code** después de actualizar para que los hooks se recarguen. La autoconfiguración del statusLine se ejecuta en cada `SessionStart` y reescribe automáticamente la ruta absoluta del script para que apunte a la nueva versión — no hace falta tocar `settings.json` a mano.

### Auto-update (opcional)

Si preferís que las actualizaciones se apliquen solas en cada inicio de Claude Code:

1. Corré `/plugin` dentro de Claude Code
2. Cambiá a la pestaña **Marketplaces**
3. Seleccioná `claude-subagent-statusline`
4. Pulsá **Enable auto-update**

Las marketplaces de terceros tienen auto-update desactivado por defecto — basta con prenderlo una vez. Después es transparente: cada vez que inicies Claude Code se actualiza sola si hay nueva versión.

## Configuración

El plugin se autoconfigura en la primera sesión tras instalarlo:

- Si **no tienes ningún `statusLine`** definido → el plugin lo registra automáticamente con su renderizador.
- Si **ya tienes otro `statusLine`** propio → el plugin lo respeta y muestra un aviso al inicio de la sesión con instrucciones para cambiar.
- **Antes de cualquier modificación** se guarda un backup en `~/.claude/settings.json.<timestamp>.bak`.

Para desactivar la autoconfiguración, define la variable de entorno `CSL_NO_AUTO_CONFIGURE=1`.

### Configuración manual (opcional)

Si prefieres configurarlo a mano, añade esto a `~/.claude/settings.json` reemplazando `<RUTA>` con la ruta de instalación real del plugin (la podés ver en `~/.claude/plugins/installed_plugins.json`, campo `installPath`):

```json
"statusLine": {
  "type": "command",
  "command": "node \"<RUTA>/scripts/statusline.js\""
}
```

> **Importante**: usa la ruta absoluta. La variable `${CLAUDE_PLUGIN_ROOT}` solo se expande dentro del `hooks.json` del plugin — Claude Code no la sustituye en `statusLine.command` del `settings.json` del usuario. Por eso la autoconfiguración escribe la ruta absoluta y la actualiza en cada upgrade del plugin.

## Coexistencia con otro statusLine

Si ya tienes otro renderizador de statusLine, puedes leer el estado de las delegaciones desde el archivo JSONL y añadir los contadores a tu salida actual. El archivo de contadores está en `~/.claude/state/delegations-<session_id>.jsonl`. Cada entrada contiene los campos `id`, `status` (`running` | `done` | `failed`) y `started`. Contar identificadores únicos da los totales de en ejecución, completadas y fallidas.

## Historial persistente de delegaciones

Cada delegación de Task se registra en un archivo JSONL global con el prompt completo, los metadatos, el resultado y el texto de respuesta del sub-agente (truncado a 16 KB). El archivo tiene un tope de 500 entradas (buffer circular) y persiste entre sesiones.

Ubicación por defecto: `~/.claude/state/delegation-history.jsonl`
Ubicación personalizada: define `CLAUDE_PLUGIN_DATA=/tu/directorio` — el plugin escribirá en `$CLAUDE_PLUGIN_DATA/history.jsonl`.

## Aviso de privacidad

El archivo de historial guarda el **prompt completo** y el **texto de respuesta del sub-agente** (truncado a 16 KB) de cada delegación. Si tus prompts o las respuestas contienen información sensible, revisa el archivo antes de compartirlo o subirlo a un repositorio. El archivo es local de tu máquina y este plugin no lo envía a ningún sitio.

## Cómo funciona

1. **SessionStart** se dispara al iniciar una sesión nueva — comprueba `~/.claude/settings.json` y registra el `statusLine` del plugin si no hay ninguno o si apunta a una versión anterior del propio plugin (ver [Configuración](#configuración)).
2. **PreToolUse** se dispara cuando Claude Code lanza una delegación de Task — el hook añade una entrada `"running"` al archivo de contadores de la sesión Y una entrada completa (incluyendo el prompt completo) al archivo de historial global.
3. **PostToolUse** se dispara cuando la tarea termina — el hook añade una entrada `"done"` tanto al archivo de contadores como al historial (con métricas de coste y de tokens).
4. **PostToolUseFailure** se dispara cuando la tarea falla — el hook añade una entrada `"failed"` a ambos archivos (las métricas son nulas porque los payloads de fallo no transportan datos de coste de forma fiable).
5. **`statusline.js`** lee el JSONL de contadores de la sesión, cuenta los identificadores únicos en ejecución / completados / fallidos, calcula el tiempo transcurrido a partir de la entrada `started` más antigua, construye la barra de progreso a partir del porcentaje de la ventana de contexto e imprime la línea formateada en stdout.

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

Antes de fusionar cualquier cambio, todos los scripts deben pasar `npm test` (131 tests) sin ningún fallo. La CI ejecuta la matriz completa en Ubuntu, macOS y Windows en cada push.

## Licencia

MIT — consulta [LICENSE](LICENSE).
