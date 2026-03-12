#!/usr/bin/env bash
# ============================================================
# seed-aws.sh - Insertar datos de prueba en DynamoDB (AWS Cloud)
# Uso: bash scripts/seed-aws.sh
# ============================================================

set -e

REGION="us-east-1"
AWS_CMD="aws --region $REGION"

# Asegurar que se usen las credenciales correctas pasadas por env
echo "🎯 Verificando identidad en AWS..."
$AWS_CMD sts get-caller-identity > /dev/null 2>&1 || {
  echo "❌ No se pudo validar la identidad de AWS. Asegúrate de tener las credenciales configuradas."
  exit 1
}
echo "✅ Conexión establecida"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "  INSERTANDO DATOS DE PRUEBA EN AWS"
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

echo "  ✅ 3 sucursales insertadas en la nube"

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

echo "  ✅ 3 vendedores insertados en la nube"

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

echo "  ✅ Turnos inicializados en la nube"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🚀 SEED AWS COMPLETADO"
echo "═══════════════════════════════════════════════════════"
echo ""
