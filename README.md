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
| `⚡` | Sub-agentes (Tasks) **en ejecución** en este momento — incluye los lanzados en foreground (`Agent`) Y los background (`Agent` con `run_in_background: true`) |
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

## Filas por sub-agente (modelo por sub-agente)

> Requiere **Claude Code v2.1.205 o superior**. En versiones anteriores el registro se ignora silenciosamente, así que activarlo es siempre seguro.

Además de la statusline agregada, el plugin puede renderizar **una fila por cada sub-agente en ejecución**, cada una encabezada por el **modelo resuelto** en el que corre ese sub-agente (`Opus 4.8`, `Haiku 4.5`, `Sonnet 5`, `Fable 5`…). Usa el segundo contrato de statusline de Claude Code, `subagentStatusLine`: Claude Code envía un único objeto JSON por stdin (`{ ...campos, columns, tasks[] }`) y el plugin imprime una línea `{"id","content"}` por fila.

```
Opus 4.8 · Implement the checkout slice ▁▂▄▅█ 24k/200k · 45s
Sonnet 5 · Audit the changelog entries ▁▃▅▇█ 91k/200k · 2m 10s
Haiku 4.5 · Map the auth module ▁▁▁▁▁ 8k/200k · 8m 24s
```

Cada fila combina: el **modelo** (en negrita y cian; si Claude Code no expone el modelo del task, cae al placeholder `⋯`), el **effort** de ese sub-agente entre paréntesis (misma escala que el bracket principal; se omite si el payload no lo trae), el **tipo** del sub-agente cuando aporta información, la **descripción** (truncada con `…` para que la fila se mantenga dentro del ancho `columns` de la terminal) y una cola de métricas en vivo: la **tendencia de consumo**, el **contexto usado sobre la ventana** y el **tiempo transcurrido**.

**Tendencia de consumo** (`▁▂▄▅█`) — sparkline de las últimas 8 muestras de `tokenSamples`, normalizado contra su propio mínimo y máximo. Una línea que sube es un sub-agente trabajando; una línea plana es uno que dejó de consumir tokens. Combinado con el tiempo transcurrido, es la forma de detectar a simple vista cuál se colgó: en el ejemplo de arriba, la tercera fila lleva 8 minutos y su consumo no se movió. Se omite si el payload trae menos de dos muestras.

**Contexto usado** (`24k/200k`) — tokens consumidos sobre el tamaño de la ventana de ese sub-agente, en valores absolutos y no en porcentaje, para que sepas cuánto le queda sin hacer la cuenta. Por debajo de 1000 se muestra el número exacto.

**Tiempo transcurrido** (`8m 24s`) — desde el `startTime` del task, con el mismo formato que el reloj `⏱` de la statusline principal.

> El **tipo** del sub-agente casi nunca aparece: Claude Code manda `local_agent` para todo sub-agente en foreground, un valor interno idéntico en todas las filas, así que el plugin lo suprime en lugar de gastar ancho en ruido. El tipo que pediste al delegar (`Explore`, `general-purpose`…) no viaja en el payload.

El renderizador vive en `scripts/subagent-statusline.js` y se registra automáticamente bajo la clave `subagentStatusLine` de `~/.claude/settings.json`, de forma aditiva: **no toca ni modifica tu `statusLine` existente**. Si ya tenés un `subagentStatusLine` propio, el plugin lo respeta y no lo sobrescribe.

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
  "command": "node \"<RUTA>/scripts/statusline.js\"",
  "refreshInterval": 30
}
```

> **Importante**: usa la ruta absoluta. La variable `${CLAUDE_PLUGIN_ROOT}` solo se expande dentro del `hooks.json` del plugin — Claude Code no la sustituye en `statusLine.command` del `settings.json` del usuario. Por eso la autoconfiguración escribe la ruta absoluta y la actualiza en cada upgrade del plugin.

> **`refreshInterval`** indica cada cuántos segundos Claude Code vuelve a ejecutar el comando aunque no haya mensajes nuevos. Mantiene vivo el contador de la ventana de 5h y el reloj de tiempo transcurrido cuando estás idle. La autoconfiguración usa `30` por defecto; si ya tenés tu propio valor el plugin lo respeta.

Para las [filas por sub-agente](#filas-por-sub-agente-modelo-por-sub-agente) (Claude Code v2.1.205+), añadí además la clave `subagentStatusLine` apuntando al segundo script:

```json
"subagentStatusLine": {
  "type": "command",
  "command": "node \"<RUTA>/scripts/subagent-statusline.js\""
}
```

## Coexistencia con otro statusLine

Si ya tienes otro renderizador de statusLine, puedes leer el estado de las delegaciones desde el archivo JSONL y añadir los contadores a tu salida actual. El archivo de contadores está en `~/.claude/state/delegations-<session_id>.jsonl`. Cada entrada contiene los campos `id`, `status` y `started`. Los valores posibles de `status` son `running`, `done`, `failed` y `bg_launched` (este último es una línea de mapping entre `tool_use_id` y `agent_id` para sub-agentes background lanzados con `run_in_background: true` — no representa un estado terminal, se usa para que el hook `SubagentStop` correlacione la finalización real). Contar identificadores únicos por status (excluyendo `bg_launched`) da los totales de en ejecución, completadas y fallidas.

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
5. **SubagentStop** se dispara cuando un sub-agente termina realmente — para foreground es solo un evento de tracking sin acción, pero para background (donde el `PostToolUse` previo escribió una línea `bg_launched` con el `agent_id` en lugar de cerrar la entry), el hook busca el `tool_use_id` original vía `agent_id` y escribe la línea `done` correspondiente. Esto es lo que mantiene el contador `⚡ running` honesto mientras los sub-agentes background están realmente en vuelo.
6. **`statusline.js`** lee el JSONL de contadores de la sesión, cuenta los identificadores únicos en ejecución / completados / fallidos, calcula el tiempo transcurrido a partir de la entrada `started` más antigua, construye la barra de progreso a partir del porcentaje de la ventana de contexto e imprime la línea formateada en stdout.

Todos los pasos son sin estado y solo añaden contenido — sin daemons, sin bloqueos, sin ediciones in situ. El archivo de historial se recorta de forma atómica (archivo temporal + rename) cuando supera las 600 líneas, conservando las últimas 500.

## Solución de problemas

**Los hooks no se disparan / los contadores se quedan en 0**
Reinicia Claude Code. Los hooks se registran al arrancar; una instancia en ejecución no detecta plugins recién instalados.

**El archivo JSONL no aparece en `~/.claude/state/`**
Verifica que el directorio existe y se puede escribir. Si no existe, créalo:

- Linux/macOS: `mkdir -p ~/.claude/state`
- Windows (PowerShell): `New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\state"`

**Los contadores muestran valores raros**
Inspecciona el JSONL crudo de la sesión actual. Las delegaciones **foreground** generan dos líneas: una con `"status":"running"` (de PreToolUse) y otra con `"status":"done"` o `"status":"failed"` (de PostToolUse o PostToolUseFailure). Las delegaciones **background** (`Agent` con `run_in_background: true`) generan **tres**: la `running` de PreToolUse, una `bg_launched` con el `agent_id` (de PostToolUse cuando `tool_response.status === "async_launched"`), y finalmente una `done` desde el hook `SubagentStop` cuando el sub-agente realmente termina. Si solo ves líneas `running` o `bg_launched`, puede que el sub-agente aún esté en curso o que el hook correspondiente no se haya disparado.

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

Antes de fusionar cualquier cambio, todos los scripts deben pasar `npm test` (216 tests) sin ningún fallo. La CI ejecuta la matriz completa en Ubuntu, macOS y Windows en cada push.

## Licencia

MIT — consulta [LICENSE](LICENSE).
