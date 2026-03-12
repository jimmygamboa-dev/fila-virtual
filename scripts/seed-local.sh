#!/usr/bin/env bash
# ============================================================
# seed-local.sh - Crear tablas y datos de prueba en DynamoDB Local
# Uso: bash scripts/seed-local.sh
# ============================================================

set -e

ENDPOINT="http://localhost:8000"
REGION="us-east-1"
AWS_CMD="aws --endpoint-url $ENDPOINT --region $REGION"

# Credenciales dummy para DynamoDB local
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=us-east-1

echo "🎯 Verificando conexión con DynamoDB Local en $ENDPOINT..."
$AWS_CMD dynamodb list-tables > /dev/null 2>&1 || {
  echo "❌ No se pudo conectar a DynamoDB Local. ¿Está corriendo docker-compose up -d?"
  exit 1
}
echo "✅ Conexión establecida"
echo ""

# ──────────────────────────────────────────────────────────────
# Función helper para crear tabla o ignorar si ya existe
# ──────────────────────────────────────────────────────────────
create_table_if_not_exists() {
  local TABLE_NAME=$1
  local CREATE_CMD=$2

  if $AWS_CMD dynamodb describe-table --table-name "$TABLE_NAME" > /dev/null 2>&1; then
    echo "  ⏭  Tabla '$TABLE_NAME' ya existe, omitiendo..."
  else
    echo "  📦 Creando tabla '$TABLE_NAME'..."
    eval "$CREATE_CMD"
    echo "  ✅ Tabla '$TABLE_NAME' creada"
  fi
}

echo "═══════════════════════════════════════════════════════"
echo "  CREANDO TABLAS"
echo "═══════════════════════════════════════════════════════"

# ── Tabla: Sucursales ────────────────────────────────────────
create_table_if_not_exists "Sucursales" \
  "$AWS_CMD dynamodb create-table \
    --table-name Sucursales \
    --attribute-definitions AttributeName=SucursalId,AttributeType=S \
    --key-schema AttributeName=SucursalId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST > /dev/null"

# ── Tabla: Vendedores ────────────────────────────────────────
create_table_if_not_exists "Vendedores" \
  "$AWS_CMD dynamodb create-table \
    --table-name Vendedores \
    --attribute-definitions \
      AttributeName=VendedorId,AttributeType=S \
      AttributeName=SucursalId,AttributeType=S \
    --key-schema AttributeName=VendedorId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --global-secondary-indexes '[
      {
        \"IndexName\": \"SucursalIndex\",
        \"KeySchema\": [{\"AttributeName\": \"SucursalId\", \"KeyType\": \"HASH\"}],
        \"Projection\": {\"ProjectionType\": \"ALL\"}
      }
    ]' > /dev/null"

# ── Tabla: Turnos ────────────────────────────────────────────
create_table_if_not_exists "Turnos" \
  "$AWS_CMD dynamodb create-table \
    --table-name Turnos \
    --attribute-definitions AttributeName=SucursalId,AttributeType=S \
    --key-schema AttributeName=SucursalId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST > /dev/null"

# ── Tabla: CodigosSetup ──────────────────────────────────────
create_table_if_not_exists "CodigosSetup" \
  "$AWS_CMD dynamodb create-table \
    --table-name CodigosSetup \
    --attribute-definitions AttributeName=Codigo,AttributeType=S \
    --key-schema AttributeName=Codigo,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST > /dev/null"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  INSERTANDO DATOS DE PRUEBA"
echo "═══════════════════════════════════════════════════════"

HOY=$(date +%Y-%m-%d)

# ── Sucursales ───────────────────────────────────────────────
echo "  🏬 Insertando sucursales..."

$AWS_CMD dynamodb put-item --table-name Sucursales --item '{
  "SucursalId":  {"S": "SUC-001"},
  "Nombre":      {"S": "Sucursal Central - Microcentro"},
  "IP_Fija":     {"S": "192.168.1.105"},
  "Prefijo":     {"S": "A"},
  "Estado":      {"S": "activa"},
  "CreadaEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

$AWS_CMD dynamodb put-item --table-name Sucursales --item '{
  "SucursalId":  {"S": "SUC-002"},
  "Nombre":      {"S": "Sucursal Norte - San Isidro"},
  "IP_Fija":     {"S": "186.22.45.12"},
  "Prefijo":     {"S": "B"},
  "Estado":      {"S": "activa"},
  "CreadaEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

$AWS_CMD dynamodb put-item --table-name Sucursales --item '{
  "SucursalId":  {"S": "SUC-003"},
  "Nombre":      {"S": "Sucursal Sur - Avellaneda"},
  "IP_Fija":     {"S": "201.5.112.89"},
  "Prefijo":     {"S": "C"},
  "Estado":      {"S": "inactiva"},
  "CreadaEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

echo "  ✅ 3 sucursales insertadas"

# ── Vendedores ───────────────────────────────────────────────
echo "  👤 Insertando vendedores..."

$AWS_CMD dynamodb put-item --table-name Vendedores --item '{
  "VendedorId":  {"S": "VEN-001"},
  "Nombre":      {"S": "Ricardo Mollo"},
  "Email":       {"S": "ricardo@reputurno.com"},
  "SucursalId":  {"S": "SUC-001"},
  "Estado":      {"S": "activo"},
  "CreadoEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

$AWS_CMD dynamodb put-item --table-name Vendedores --item '{
  "VendedorId":  {"S": "VEN-002"},
  "Nombre":      {"S": "Leon Gieco"},
  "Email":       {"S": "leon@reputurno.com"},
  "SucursalId":  {"S": "SUC-002"},
  "Estado":      {"S": "activo"},
  "CreadoEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

$AWS_CMD dynamodb put-item --table-name Vendedores --item '{
  "VendedorId":  {"S": "VEN-003"},
  "Nombre":      {"S": "Gustavo Santaolalla"},
  "Email":       {"S": "gustavo@reputurno.com"},
  "SucursalId":  {"S": "SUC-003"},
  "Estado":      {"S": "pendiente_setup"},
  "CreadoEn":    {"S": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}
}' > /dev/null

echo "  ✅ 3 vendedores insertados"

# ── Turnos iniciales ─────────────────────────────────────────
echo "  🎫 Inicializando turnos..."

$AWS_CMD dynamodb put-item --table-name Turnos --item '{
  "SucursalId":    {"S": "SUC-001"},
  "NumeroActual":  {"N": "42"},
  "Prefijo":       {"S": "A"},
  "FechaUltimo":   {"S": "'"$HOY"'"}
}' > /dev/null

$AWS_CMD dynamodb put-item --table-name Turnos --item '{
  "SucursalId":    {"S": "SUC-002"},
  "NumeroActual":  {"N": "15"},
  "Prefijo":       {"S": "B"},
  "FechaUltimo":   {"S": "'"$HOY"'"}
}' > /dev/null

echo "  ✅ Turnos inicializados (A-042, B-015)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🚀 SEED COMPLETADO"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Tablas disponibles:"
$AWS_CMD dynamodb list-tables --output table
echo ""
echo "  🌐 DynamoDB Admin UI: http://localhost:8001"
echo "  💡 Listo para: sam local start-api --env-vars env.json"
echo ""
