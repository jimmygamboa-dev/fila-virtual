# Fila Virtual — Sistema de Gestión de Turnos

> Sistema serverless de bajo costo para gestión de turnos en ventas de repuestos. Acceso **Passwordless** para vendedores en dispositivos Android POS (Sunmi V2 / XP-P1).

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Infraestructura | AWS SAM (Serverless Application Model) |
| Base de Datos | DynamoDB (Local en dev / AWS en prod) |
| Backend | API Gateway REST + Lambda (Node.js 18.x) |
| Frontend | Vanilla JS + Tailwind CSS (PWA) |
| Auth | JWT HS256 local / Cognito en producción |
| Impresión | ESC/POS via intent RawBT (Android) |

---

## Estructura del Proyecto

```
Fila virtual/
├── template.yaml            # Definición SAM: DynamoDB, Lambda, API Gateway
├── samconfig.toml           # Config local de SAM CLI
├── docker-compose.yml       # DynamoDB Local (8000) + Admin UI (8001)
├── env.json                 # Variables de entorno para SAM local
├── package.json             # SDK v3, jwt, uuid
│
├── src/
│   ├── handlers/
│   │   ├── admin.js         # CRUD sucursales + vendedores + setup links
│   │   ├── setup.js         # Validar código → emitir JWT permanente
│   │   └── turnos.js        # Incremento atómico (0-99), reinicio diario
│   └── utils/
│       ├── dynamodb.js      # DynamoDB DocumentClient (local/AWS)
│       └── auth.js          # JWT sign/verify
│
├── scripts/
│   └── seed-local.sh        # Crear tablas + seed en DynamoDB Local
│
└── frontend/
    ├── admin/index.html     # Panel Admin (conectado a API local)
    └── setup/index.html     # Activación passwordless del vendedor
```

---

## 🚀 Inicio Rápido (Desarrollo Local)

### Pre-requisitos

```bash
# Verificar instalaciones
node --version    # >= 18.0.0
docker --version  # >= 20.x
aws --version     # AWS CLI v2
sam --version     # SAM CLI >= 1.100.0

# Instalar SAM CLI (si no está instalado)
brew tap aws/tap && brew install aws-sam-cli
```

### Paso 1 — Instalar dependencias

```bash
cd "Fila virtual"
npm install
```

### Paso 2 — Levantar DynamoDB Local

```bash
docker-compose up -d

# Verificar que está corriendo
docker-compose ps
# → fila-virtual-dynamodb    Up  0.0.0.0:8000->8000/tcp
# → fila-virtual-dynamodb-admin  Up  0.0.0.0:8001->8001/tcp
```

### Paso 3 — Crear tablas y datos de prueba

```bash
bash scripts/seed-local.sh
```

**Tablas creadas:**
- `Sucursales` — Central, Norte, Sur (con IP fija y prefijo A/B/C)
- `Vendedores` — Ricardo Mollo, Leon Gieco, Gustavo Santaolalla
- `Turnos` — Inicializados: A-042, B-015
- `CodigosSetup` — Vacía (se llena al generar links)

### Paso 4 — Levantar API SAM local

```bash
sam build && sam local start-api --env-vars env.json

# El API queda disponible en:
# http://localhost:3000
```

> **Nota macOS**: Si tienes problemas con Docker networking, añade la flag:
> `sam local start-api --env-vars env.json --docker-network host`

### Paso 5 — Abrir el Panel Admin

Abre el archivo directamente en tu navegador:
```
frontend/admin/index.html
```
O usa Live Server (VS Code) para hot-reload en `http://localhost:5500`.

**🌐 DynamoDB Admin UI**: http://localhost:8001 (para inspección visual de tablas)

---

## 📡 Endpoints del API

### Sucursales
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/sucursales` | Listar todas |
| POST | `/sucursales` | Crear nueva |
| PUT | `/sucursales/{id}` | Actualizar |

### Vendedores
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/vendedores` | Listar (con datos de sucursal) |
| POST | `/vendedores` | Crear nuevo |
| DELETE | `/vendedores/{id}` | Eliminar |
| POST | `/vendedores/{id}/setup-link` | Generar link de activación |

### Setup (Passwordless)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/setup?code=XYZ` | Validar código y emitir JWT |

### Turnos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/turnos/{sucursalId}` | Turno actual |
| POST | `/turnos/{sucursalId}/incrementar` | Incremento atómico |
| POST | `/turnos/{sucursalId}/resetear` | Reseteo manual |

---

## 🧪 Test rápido con curl

```bash
BASE="http://localhost:3000"

# Listar sucursales
curl $BASE/sucursales | jq

# Crear vendedor
curl -X POST $BASE/vendedores \
  -H "Content-Type: application/json" \
  -d '{"Nombre":"Test User","Email":"test@test.com","SucursalId":"SUC-001"}' | jq

# Generar link de setup (reemplaza VEN-XXX con el ID devuelto)
curl -X POST $BASE/vendedores/VEN-001/setup-link | jq

# Validar código de setup
curl "$BASE/setup?code=CODIGO_GENERADO" | jq

# Incrementar turno
curl -X POST $BASE/turnos/SUC-001/incrementar | jq

# Ver turno actual
curl $BASE/turnos/SUC-001 | jq
```

---

## 🔑 Flujo Passwordless (Vendedor)

```
Admin genera link         Vendedor abre link         JWT guardado
──────────────────────────────────────────────────────────────────
POST /vendedores/ID/    →  /setup?code=UUID   →  localStorage
  setup-link               ↓ valida código        token (10 años)
  ↓                        ↓ marca como usado     ↓
  retorna URL              ↓ activa vendedor      Terminal listo
  con código UUID          ↓ emite JWT            sin contraseña
```

---

## 🎫 Lógica de Turnos (Core)

```
┌─────────────────────────────────────────────────────────┐
│  POST /turnos/{sucursalId}/incrementar                  │
│                                                         │
│  ¿FechaUltimo != hoy?  →  Resetear a 0 (reinicio diario)│
│  ¿NumeroActual < 99?   →  NumeroActual + 1              │
│  ¿NumeroActual = 99?   →  Resetear a 0 (ciclo completo) │
│                                                         │
│  Formato: {Prefijo}-{NumeroActual.padStart(3, '0')}     │
│  Ejemplo: A-042, B-099, C-000                           │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 Variables de Entorno (`env.json`)

| Variable | Local | Producción |
|----------|-------|-----------|
| `DYNAMODB_ENDPOINT` | `http://host.docker.internal:8000` | *(vacío)* |
| `JWT_SECRET` | `fila-virtual-local-secret-2024` | SSM Parameter Store |
| `FRONTEND_URL` | `http://localhost:5500` | CloudFront URL |

---

## 📦 Comandos útiles

```bash
# Detener DynamoDB Local
docker-compose down

# Ver logs de los contenedores Docker
docker-compose logs -f

# Re-ejecutar seed (resetea datos)
bash scripts/seed-local.sh

# Build de SAM
sam build

# Validar template
sam validate

# Ver tablas en DynamoDB Local
aws --endpoint-url http://localhost:8000 \
    --region us-east-1 \
    dynamodb list-tables \
    --output table
```

---

## 🗺️ Roadmap — Fases Siguientes

- **Fase 2**: Terminal del Vendedor (POS) — Impresión ESC/POS via RawBT
- **Fase 3**: Dashboard de Monitor — Web Speech API, WebSockets
- **Fase 4**: Despliegue AWS — Cognito, CloudFront, SES para invitaciones
- **Fase 5**: App PWA Offline — Service Worker para modo sin internet

---

*© 2024 Fila Virtual — Sistema de Turnos Serverless*
