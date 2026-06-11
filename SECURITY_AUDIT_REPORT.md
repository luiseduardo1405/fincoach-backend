# Informe de Auditoría de Seguridad — fincoach-backend

**Fecha:** 2026-06-08
**Auditor:** Claude Code (Anthropic)
**Metodología:** OWASP Top 10:2021
**Tipo de prueba:** White-box (acceso completo al código fuente)
**Alcance:** API REST construida con Fastify + Drizzle ORM + PostgreSQL

---

## Resumen Ejecutivo

Se realizó un análisis estático completo del código fuente del proyecto `fincoach-backend` siguiendo la metodología OWASP Top 10:2021. Se identificaron **7 vulnerabilidades** distribuidas en severidades Alta (2), Media (4) y Baja (1), más 1 hallazgo de componente vulnerable en dependencias de desarrollo.

Todas las vulnerabilidades identificadas han sido **corregidas y migradas** en esta misma sesión. El proyecto no presentó vectores de inyección SQL, SSRF ni bypass de autenticación — la arquitectura base era sólida; los hallazgos correspondieron a validación de input, precisión numérica y logging de seguridad.

### Tabla Resumen de Hallazgos

| ID | Categoría OWASP | Severidad | Estado |
|----|-----------------|-----------|--------|
| F-01 | A07 — Auth Failures | **ALTA** | ✅ Corregido |
| F-02 | A02 — Cryptographic Failures | **ALTA** | ✅ Corregido |
| F-03 | A09 — Logging Failures | **MEDIA** | ✅ Corregido |
| F-04 | A07 — Auth Failures | **MEDIA** | ✅ Corregido |
| F-05 | A04 — Insecure Design | **MEDIA** | ✅ Corregido |
| F-06 | A08 — Integrity Failures | **MEDIA** | ✅ Corregido |
| F-07 | A05 — Security Misconfiguration | **BAJA** | ✅ Corregido |
| F-08 | A06 — Vulnerable Components | **BAJA** | ⚠️ Dev-only, sin acción |

### Categorías sin hallazgos (PASS)

| Categoría | Evaluación |
|-----------|------------|
| A01 — Broken Access Control | Todos los endpoints filtran recursos por `req.user.sub` del JWT. Sin IDOR detectado. |
| A03 — Injection | Drizzle ORM usa queries parametrizadas en todas las operaciones, incluyendo los bloques `sql` template tag. |
| A10 — SSRF | No existen URLs controladas por el usuario en ningún request HTTP saliente. |

---

## Hallazgos Detallados

---

### F-01 — Middleware `authenticate` revela detalles internos del JWT

**Severidad:** ALTA
**Categoría:** A07:2021 — Identification and Authentication Failures
**Archivo:** `src/index.ts`

#### Descripción

El decorador `authenticate` de Fastify capturaba el error de verificación JWT y lo enviaba directamente al cliente con `reply.send(err)`. El plugin `@fastify/jwt` lanza objetos `FastifyError` que incluyen el campo `message` con el motivo exacto del fallo.

#### Evidencia

```typescript
// CÓDIGO VULNERABLE
app.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err); // ← envía el objeto de error completo
  }
});
```

Respuesta que recibía un atacante con un token manipulado:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "invalid signature"
}
```

Y con un token expirado:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "jwt expired"
}
```

#### Impacto

Un atacante puede distinguir entre tokens expirados (válidos en estructura pero vencidos) y tokens con firma inválida (intentos de forgery). Esto permite al atacante entender qué ataques son detectados y cuáles no, reduciendo el tiempo de reconocimiento.

#### Corrección Aplicada

```typescript
// CÓDIGO CORREGIDO
app.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'No autorizado' });
  }
});
```

---

### F-02 — Montos financieros almacenados como `real` (float32)

**Severidad:** ALTA
**Categoría:** A02:2021 — Cryptographic Failures / Data Integrity
**Archivo:** `src/db/schema.ts`

#### Descripción

Las columnas `amount` (en `transactions` y `fiados`) y `capital` (en `users`) estaban definidas con el tipo PostgreSQL `REAL`, que es un número de punto flotante de 32 bits con aproximadamente 6-7 dígitos significativos de precisión.

#### Evidencia

```typescript
// ESQUEMA VULNERABLE
capital: real('capital').notNull().default(0),   // float32
amount:  real('amount').notNull(),               // float32
```

**Ejemplo de error de precisión con `real`:**
- Valor ingresado: `1234567.89`
- Valor almacenado: `1234568.0` (pérdida de centavos)

Para un usuario con decenas de transacciones, el acumulado en `balance.ts` puede desviarse de la realidad financiera real.

#### Impacto

Pérdida silenciosa de precisión en cálculos de balance, ganancias y reportes mensuales. Para una aplicación de gestión financiera de microempresas, errores de redondeo acumulados pueden generar discrepancias entre el balance mostrado y los fondos reales del usuario.

#### Corrección Aplicada

```typescript
// ESQUEMA CORREGIDO
import { numeric } from 'drizzle-orm/pg-core';

// numeric(12,2): hasta 9.999.999.999,99 con 2 decimales exactos
capital: numeric('capital', { precision: 12, scale: 2 }).notNull().default('0'),
amount:  numeric('amount',  { precision: 12, scale: 2 }).notNull(),
```

Se generó y ejecutó la migración correspondiente (`drizzle/0000_violet_menace.sql`). Todos los inserts y aritmética en los route handlers fueron actualizados para manejar el tipo `string` que retorna Drizzle para columnas `numeric`.

---

### F-03 — Ausencia de logging de eventos de seguridad

**Severidad:** MEDIA
**Categoría:** A09:2021 — Security Logging and Monitoring Failures
**Archivo:** `src/routes/auth.ts`

#### Descripción

Los endpoints de autenticación `/auth/register` y `/auth/login` no registraban ningún evento de seguridad. Sin logs de autenticación, es imposible:
- Detectar ataques de fuerza bruta que evadan el rate limiter (e.g., IPs rotadas)
- Reconstruir el timeline de un incidente de seguridad
- Alertar ante patrones anómalos de acceso

#### Evidencia

```typescript
// CÓDIGO VULNERABLE — sin logging
const [user] = await db.select()...
if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
  return reply.status(401).send({ error: 'Credenciales inválidas' });
}
// login exitoso — tampoco logueado
```

#### Impacto

Ausencia total de auditoría. Un atacante que logre credenciales válidas no deja rastro. Un ataque de fuerza bruta distribuido no genera alertas aunque eventualmente tenga éxito.

#### Corrección Aplicada

```typescript
// CÓDIGO CORREGIDO — eventos estructurados con request ID automático de Fastify
if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
  req.log.warn({ event: 'auth.login.fail', email }, 'Intento de login fallido');
  return reply.status(401).send({ error: 'Credenciales inválidas' });
}

req.log.info({ event: 'auth.login.success', userId: user.id }, 'Login exitoso');
```

Los logs incluyen automáticamente: `requestId`, `method`, `url`, `remoteAddress`, `timestamp` (gestionados por Fastify). En producción (`NODE_ENV=production`), el nivel de log es `warn`, por lo que los fallos de autenticación sí se registran.

---

### F-04 — Schema de login sin restricciones de validación

**Severidad:** MEDIA
**Categoría:** A07:2021 — Identification and Authentication Failures
**Archivo:** `src/routes/auth.ts`

#### Descripción

El body schema del endpoint `POST /auth/login` definía `email` y `password` como strings sin ninguna restricción de formato o longitud, a diferencia del `/register` que sí tenía `format: 'email'` y `maxLength`.

#### Evidencia

```typescript
// SCHEMA VULNERABLE
const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string' },     // sin format ni maxLength
    password: { type: 'string' },  // sin maxLength
  },
} as const;
```

**Consecuencias:**
1. Un atacante podía enviar un `email` de 1 MB, forzando una query con un WHERE de string enorme al ORM.
2. Sin `format: 'email'`, strings como `"' OR 1=1--"` pasaban la validación de Fastify antes de llegar a Drizzle (Drizzle parametriza la query, pero el formato ya debería rechazarse en validación).

#### Corrección Aplicada

```typescript
// SCHEMA CORREGIDO
const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', maxLength: 128 },
  },
} as const;
```

---

### F-05 — Ausencia de validación de formato en parámetro `month`

**Severidad:** MEDIA
**Categoría:** A04:2021 — Insecure Design
**Archivo:** `src/routes/reports.ts`

#### Descripción

El endpoint `GET /reports/monthly?month=YYYY-MM` aceptaba cualquier string para el parámetro `month`. El valor era procesado directamente con `split('-').map(Number)` y pasado a `new Date()`. Un input inválido producía `new Date(NaN, NaN, 1)` — una fecha inválida que al ser pasada al ORM generaba un error 500.

#### Evidencia

```
GET /reports/monthly?month=hola-mundo
→ 500 Internal Server Error
  (Postgres recibe un timestamp NaN → error de tipo)
```

```typescript
// CÓDIGO VULNERABLE
const monthStr = req.query.month ?? new Date().toISOString().slice(0, 7);
const [year, month] = monthStr.split('-').map(Number); // NaN si input inválido
const from = new Date(year, month - 1, 1);             // Invalid Date
```

#### Impacto

Un atacante o cliente mal formado puede provocar errores 500 repetidos, exponer stack traces en logs y, en condiciones de alta carga, generar errores de base de datos que afecten otras operaciones.

#### Corrección Aplicada

```typescript
// CÓDIGO CORREGIDO
if (!/^\d{4}-\d{2}$/.test(monthStr)) {
  return reply.status(400).send({ error: 'Formato de mes inválido. Use YYYY-MM' });
}
```

---

### F-06 — Fechas sin validación de formato en múltiples endpoints

**Severidad:** MEDIA
**Categoría:** A08:2021 — Software and Data Integrity Failures
**Archivos:** `src/routes/transactions.ts`, `src/routes/fiados.ts`

#### Descripción

Los campos `occurredAt` (POST/PUT `/transactions`), `timestamp` (POST `/fiados`) y los filtros `from`/`to` (GET `/transactions`) aceptaban cualquier string de hasta 30 caracteres. Al pasar un string no parseable a `new Date()`, se obtenía `Invalid Date`, que el ORM intentaba insertar como timestamp, causando error 500 del servidor.

#### Evidencia

```
POST /transactions
Body: { "type": "venta", "amount": 100, "occurredAt": "no-es-una-fecha" }
→ 500 Internal Server Error

GET /transactions?from=ayer&to=manana
→ 500 Internal Server Error (Postgres type error)
```

#### Corrección Aplicada

Se agregó la propiedad `pattern` en los schemas de AJV para validar el prefijo ISO 8601 `YYYY-MM-DD` antes de llegar al handler:

```typescript
// SCHEMAS CORREGIDOS
occurredAt: { type: 'string', maxLength: 30, pattern: '^\\d{4}-\\d{2}-\\d{2}' },
timestamp:  { type: 'string', maxLength: 30, pattern: '^\\d{4}-\\d{2}-\\d{2}' },
from:       { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}' },
to:         { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}' },
```

Fastify retorna automáticamente 400 con mensaje descriptivo si el pattern no se cumple.

---

### F-07 — Endpoint `/health` expone versión de la aplicación

**Severidad:** BAJA
**Categoría:** A05:2021 — Security Misconfiguration
**Archivo:** `src/index.ts`

#### Descripción

El endpoint público `GET /health` retornaba el número de versión hardcodeado de la aplicación.

#### Evidencia

```json
GET /health
{
  "status": "ok",
  "version": "1.0.0"
}
```

#### Impacto

Un atacante puede usar el número de versión para correlacionar con CVEs específicos o regresiones de seguridad conocidas de esa versión. Aunque el impacto es bajo, es una buena práctica no exponer información de versioning en endpoints públicos.

#### Corrección Aplicada

```typescript
app.get('/health', () => ({ status: 'ok' }));
```

---

### F-08 — drizzle-kit → esbuild ≤0.24.2 (CVE GHSA-67mh-4wv8-2f99)

**Severidad:** BAJA (solo entorno de desarrollo)
**Categoría:** A06:2021 — Vulnerable and Outdated Components

#### Descripción

`drizzle-kit` (devDependency) tiene una dependencia transitiva en `esbuild ≤0.24.2`, afectado por GHSA-67mh-4wv8-2f99 (CVSS 5.3): el servidor de desarrollo de esbuild permite que cualquier sitio web envíe requests al servidor local y lea las respuestas.

#### Evaluación

Esta vulnerabilidad **no aplica a producción**: `drizzle-kit` es una herramienta de CLI usada únicamente para generar y ejecutar migraciones en desarrollo/CI. El servidor de Fastify en producción no usa esbuild.

El fix disponible requiere bajar `drizzle-kit` a `0.18.1` (versión mayor anterior), lo que rompe la API de configuración actual. Se recomienda monitorear las releases de `drizzle-kit` y actualizar cuando publiquen una versión que actualice esbuild.

#### Acción Recomendada

No aplicar el downgrade automático. Revisar `npm audit` en futuros releases:

```bash
npm audit --audit-level=high  # solo bloquear en high/critical en CI
```

---

## Análisis de la Superficie de Ataque (No Vulnerables)

### A01 — Broken Access Control: PASS

Todos los endpoints protegidos utilizan el claim `sub` del JWT verificado para filtrar recursos:

```typescript
.where(eq(transactions.userId, req.user.sub))  // transactions
.where(eq(fiados.userId, req.user.sub))        // fiados
.where(eq(users.id, req.user.sub))             // profile, balance
```

Las operaciones PUT, PATCH y DELETE incluyen `AND eq(resource.userId, req.user.sub)` en la cláusula WHERE, lo que previene IDOR (Insecure Direct Object Reference). Si el recurso no pertenece al usuario, retorna 404 (no 403, lo que evita confirmar la existencia del recurso a terceros).

### A03 — Injection: PASS

El ORM Drizzle genera únicamente queries parametrizadas. No se encontró ningún punto de construcción de SQL por concatenación de strings. Los bloques `sql` template tag en `balance.ts` y `reports.ts` usan valores hardcodeados (nombres de tipos como `'venta'`, `'gasto'`) — no hay interpolación de input del usuario en SQL raw.

### A10 — SSRF: PASS

La única integración externa es Groq (Whisper). La URL del endpoint de Groq está hardcodeada en el SDK; el input del usuario (audio binario) es enviado como payload, no como URL. No existe ningún endpoint que acepte URLs controladas por el usuario para hacer requests desde el servidor.

---

## Recomendaciones Pendientes (Fuera de Alcance del Código)

Las siguientes mejoras requieren cambios de infraestructura o decisiones de producto:

| Recomendación | Categoría | Prioridad |
|---------------|-----------|-----------|
| Implementar revocación de tokens JWT (blocklist en Redis o rotación de `secret`) | A07 | Media |
| Agregar verificación de email al registrar usuarios | A04 | Baja |
| Configurar alertas sobre eventos `auth.login.fail` consecutivos (e.g., Datadog, Grafana) | A09 | Media |
| Agregar `npm audit --audit-level=high` como gate en CI/CD | A06 | Baja |

---

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/db/schema.ts` | `real` → `numeric(12,2)` en columnas `amount` y `capital` |
| `src/index.ts` | Fix `authenticate` (error genérico 401) · Eliminar versión de `/health` |
| `src/routes/auth.ts` | Constraints en `loginBody` · Logging de eventos de seguridad |
| `src/routes/reports.ts` | Validación de formato `YYYY-MM` en parámetro `month` |
| `src/routes/transactions.ts` | Pattern `YYYY-MM-DD` en `occurredAt`, `from`, `to` · Conversión `amount.toString()` |
| `src/routes/fiados.ts` | Pattern `YYYY-MM-DD` en `timestamp` · Conversión `amount.toString()` |
| `src/routes/voice.ts` | Conversión `amount.toString()` al insertar |
| `src/routes/profile.ts` | Conversión `capital.toString()` al actualizar |
| `src/routes/balance.ts` | `Number(capital)` para aritmética correcta con `numeric` |
| `drizzle/0000_violet_menace.sql` | Migración generada y aplicada |
