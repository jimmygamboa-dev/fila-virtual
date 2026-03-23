'use strict';

const { docClient } = require('../utils/dynamodb');
const { verifyToken, extractBearerToken } = require('../utils/auth');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const TURNOS_TABLE = process.env.TURNOS_TABLE || 'Turnos';
const SUCURSALES_TABLE = process.env.SUCURSALES_TABLE || 'Sucursales';

const response = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
});

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return response(200, {});

    const { httpMethod, pathParameters, path, headers } = event;
    const sucursalId = pathParameters?.sucursalId;
    const clientIp = event.requestContext?.identity?.sourceIp || '';

    console.info(`[Turnos] ${httpMethod} ${path} → sucursalId: ${sucursalId} | IP: ${clientIp}`);

    if (!sucursalId) return response(400, { success: false, error: 'sucursalId requerido' });

    try {
        // Validación Restricción de IP (Barrera de Seguridad)
        // Excepto si es OPTIONS o resetear (que lo hace el admin general).
        // Validaciones de seguridad — eximir GET (monitor de sólo lectura) y resetear (admin)
        const exemptFromIpCheck = httpMethod === 'GET' || path.endsWith('/resetear');
        if (!exemptFromIpCheck) {
            const ipAuthorized = await verificarIP(sucursalId, clientIp);
            if (!ipAuthorized) {
                return response(403, { success: false, error: 'Acceso Denegado: Su dirección IP actual no coincide con la red configurada para la sucursal.' });
            }
        }

        if (httpMethod === 'GET') {
            return await getTurnoActual(sucursalId);
        }

        if (httpMethod === 'POST' && path.endsWith('/generar')) {
            return await generarNuevoTicket(sucursalId);
        }

        if (httpMethod === 'POST' && path.endsWith('/incrementar')) {
            return await incrementarTurno(sucursalId, headers);
        }

        if (httpMethod === 'POST' && path.endsWith('/rellamar')) {
            return await rellamarTurnoBackend(sucursalId, headers);
        }

        if (httpMethod === 'POST' && path.endsWith('/resetear')) {
            return await generarNuevoTicket(sucursalId);
        }

        return response(404, { success: false, error: 'Ruta no encontrada' });
    } catch (err) {
        if (err.name === 'QueueEmptyException') {
            return response(400, { success: false, error: err.message });
        }
        console.error(`[Turnos ERROR] ${event.httpMethod} ${event.path}:`, err);
        return response(500, { success: false, error: err.message || 'Error interno del servidor' });
    }
};

// ─── GET turno actual ────────────────────────────────────────────────────────

// Formato de turno inteligente basado en longitud del límite máximo
function formatearTurno(prefijo, numero, maxNum = 99) {
    const padLen = String(maxNum).length;
    return `${prefijo || 'A'}-${String(numero).padStart(padLen, '0')}`;
}

async function getTurnoActual(sucursalId) {
    let turno = await obtenerTurno(sucursalId);
    let sucursalInfo = await docClient.send(new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } }));
    let limite = sucursalInfo.Item?.LimiteTurnos || 99;

    if (!turno) {
        // Si no existe, inicializamos en 0
        turno = await inicializarTurno(sucursalId);
    }

    return response(200, {
        success: true,
        data: {
            SucursalId: sucursalId,
            NombreSucursal: sucursalInfo.Item?.Nombre || `Sucursal ${sucursalId}`,
            NumeroActual: turno.NumeroActual,
            TurnoFormateado: formatearTurno(turno.Prefijo, turno.NumeroActual, limite),
            UltimoGenerado: turno.UltimoGenerado || 0,
            TicketFormateado: formatearTurno(turno.Prefijo, turno.UltimoGenerado || 0, limite),
            FechaUltimo: turno.FechaUltimo,
            Prefijo: turno.Prefijo || 'A',
            UltimoLlamado: turno.UltimoLlamado || null,
            VentanillasStatus: turno.VentanillasStatus || {},
            LimiteTurnos: limite,
        },
    });
}

// ─── POST /incrementar ────────────────────────────────────────────────────────

async function incrementarTurno(sucursalId, headers) {
    // En modo local: validación JWT opcional (el frontend puede omitirla)
    // En producción: validar token del vendedor
    const token = extractBearerToken(headers || {});
    const isLocal = process.env.AWS_SAM_LOCAL === 'true' || !!process.env.DYNAMODB_ENDPOINT;

    if (!isLocal && !token) {
        return response(401, { success: false, error: 'Token de autorización requerido' });
    }

    const { payload } = token ? verifyToken(token) : { payload: {} };
    const ventanilla = payload['custom:ventanilla'] || payload.ventanilla || '0';
    const nombreVendedor = payload.name || payload.email || 'Vendedor';
    const hoy = fechaLocal();

    let turno = await obtenerTurno(sucursalId);

    let sucursalInfo = await docClient.send(new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } }));
    let limite = sucursalInfo.Item?.LimiteTurnos || 99;

    if (!turno) {
        turno = await inicializarTurno(sucursalId);
    } else if (turno.FechaUltimo && turno.FechaUltimo !== hoy) {
        // Reinicio diario
        console.info(`[Turnos] Reinicio diario para ${sucursalId}: ${turno.FechaUltimo} → ${hoy}`);
        turno = await resetearTurnoDiario(sucursalId, hoy, turno.Prefijo);
    } else {
        // Incremento atómico
        turno = await incrementoAtomico(sucursalId, hoy, ventanilla, nombreVendedor, limite);
    }

    return response(200, {
        success: true,
        data: {
            SucursalId: sucursalId,
            NumeroActual: turno.NumeroActual,
            TurnoFormateado: formatearTurno(turno.Prefijo, turno.NumeroActual, limite),
            UltimoGenerado: turno.UltimoGenerado || 0,
            FechaUltimo: turno.FechaUltimo,
            Prefijo: turno.Prefijo || 'A',
            Reiniciado: turno._reiniciado || false,
            UltimoLlamado: turno.UltimoLlamado,
            VentanillasStatus: turno.VentanillasStatus,
        },
    });
}

// ─── POST /generar (para Kiosco) ─────────────────────────────────────────────

async function generarNuevoTicket(sucursalId) {
    const hoy = fechaLocal();
    let turno = await obtenerTurno(sucursalId);
    let sucursalInfo = await docClient.send(new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } }));
    let limite = sucursalInfo.Item?.LimiteTurnos || 99;

    if (!turno) {
        turno = await inicializarTurno(sucursalId);
    } else if (turno.FechaUltimo && turno.FechaUltimo !== hoy) {
        turno = await resetearTurnoDiario(sucursalId, hoy, turno.Prefijo);
    }

    // Incremento atómico del ticket generado (UltimoGenerado)
    const result = await docClient.send(new UpdateCommand({
        TableName: TURNOS_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: 'SET UltimoGenerado = if_not_exists(UltimoGenerado, :cero) + :uno',
        ExpressionAttributeValues: {
            ':uno': 1,
            ':cero': 0
        },
        ReturnValues: 'ALL_NEW',
    }));

    const attrs = result.Attributes;
    // Si el ticket excede el límite circular, lo reseteamos a 1
    if (attrs.UltimoGenerado > limite) {
        const resetRes = await docClient.send(new UpdateCommand({
            TableName: TURNOS_TABLE,
            Key: { SucursalId: sucursalId },
            UpdateExpression: 'SET UltimoGenerado = :uno',
            ExpressionAttributeValues: { ':uno': 1 },
            ReturnValues: 'ALL_NEW'
        }));
        return response(200, {
            success: true,
            data: {
                Ticket: formatearTurno(resetRes.Attributes.Prefijo, 1, limite),
                Numero: 1,
                Sucursal: sucursalInfo.Item?.Nombre || sucursalId
            }
        });
    }

    return response(200, {
        success: true,
        data: {
            Ticket: formatearTurno(attrs.Prefijo, attrs.UltimoGenerado, limite),
            Numero: attrs.UltimoGenerado,
            Sucursal: sucursalInfo.Item?.Nombre || sucursalId
        }
    });
}

// ─── POST /rellamar ────────────────────────────────────────────────────────
async function rellamarTurnoBackend(sucursalId, headers) {
    const token = extractBearerToken(headers || {});
    const isLocal = process.env.AWS_SAM_LOCAL === 'true' || !!process.env.DYNAMODB_ENDPOINT;

    if (!isLocal && !token) {
        return response(401, { success: false, error: 'Token de autorización requerido' });
    }

    const current = await obtenerTurno(sucursalId);
    if (!current || !current.UltimoLlamado) {
        return response(400, { success: false, error: 'No hay ningún turno actual para rellamar.' });
    }

    // Actualizamos únicamente el Timestamp del último llamado
    // Esto provocará un cambio en el objeto que el Monitor detectará en su Polling
    const nuevoUltimoLlamado = {
        ...current.UltimoLlamado,
        Timestamp: new Date().toISOString()
    };

    // Actualizamos también la VentanillasStatus para forzar la detección por ventanilla
    const ventanilla = current.UltimoLlamado.Ventanilla;
    const ventanillasMap = current.VentanillasStatus || {};
    // Agregamos un hash invisible temporal o actualizamos el timestamp interno de la ventanilla
    // Como el monitor usa "currentTurn !== lastTurn", si el string de ventanillasMap es igual, lo ignorará.
    // Necesitamos que el valor devuelto cambie para que el monitor lo encole.
    ventanillasMap[String(ventanilla)] = `${current.UltimoLlamado.Turno}|${Date.now()}`;

    const result = await docClient.send(new UpdateCommand({
        TableName: TURNOS_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: 'SET UltimoLlamado = :ul, VentanillasStatus = :vs',
        ExpressionAttributeValues: {
            ':ul': nuevoUltimoLlamado,
            ':vs': ventanillasMap
        },
        ReturnValues: 'ALL_NEW',
    }));

    return response(200, {
        success: true,
        message: 'Rellamada efectuada'
    });
}

// ─── POST /resetear (manual desde admin) ─────────────────────────────────────

async function resetearTurno(sucursalId) {
    const sucursalRes = await docClient.send(
        new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } })
    );

    const prefijo = sucursalRes.Item?.Prefijo || 'A';
    const limite = sucursalRes.Item?.LimiteTurnos || 99;
    const hoy = fechaLocal();

    const result = await docClient.send(new UpdateCommand({
        TableName: TURNOS_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: 'SET NumeroActual = :cero, UltimoGenerado = :cero, FechaUltimo = :hoy, Prefijo = :p, ReseteoManual = :ts, UltimoLlamado = :ul, VentanillasStatus = :vs',
        ExpressionAttributeValues: {
            ':cero': 0,
            ':hoy': hoy,
            ':p': prefijo,
            ':ts': new Date().toISOString(),
            ':ul': null,
            ':vs': {}
        },
        ReturnValues: 'ALL_NEW',
    }));

    const attrs = result.Attributes;
    return response(200, {
        success: true,
        message: 'Turno reseteado manualmente a 0',
        data: {
            SucursalId: sucursalId,
            NumeroActual: attrs.NumeroActual,
            TurnoFormateado: formatearTurno(attrs.Prefijo, attrs.NumeroActual, limite),
        },
    });
}

// ─── Helpers internos ────────────────────────────────────────────────────────

async function obtenerTurno(sucursalId) {
    const res = await docClient.send(
        new GetCommand({ TableName: TURNOS_TABLE, Key: { SucursalId: sucursalId } })
    );
    return res.Item;
}

// Verifica si la IP del cliente coincide con la IP_Fija de la sucursal
async function verificarIP(sucursalId, clientIp) {
    // Si estamos en entorno de desarrollo local, permitimos todo por default
    if (process.env.AWS_SAM_LOCAL === 'true') return true;

    // Consultar la sucursal para leer su IP_Fija configurada
    const res = await docClient.send(
        new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } })
    );
    const ipFija = res.Item?.IP_Fija;

    // Si la sucursal no tiene IP fija configurada (vacío), permitimos acceso (fail-open)
    if (!ipFija || ipFija.trim() === '') {
        return true;
    }

    // Comparamos. Podemos soportar múltiples IPs separadas por coma en un futuro, 
    // pero por ahora es 1 a 1 (limpiando espacios)
    const ipAutorizada = ipFija.trim();

    // Logs de auditoría
    console.info(`[Seguridad] Validando acceso - IP Cliente: ${clientIp} | IP Requerida: ${ipAutorizada}`);

    return clientIp === ipAutorizada;
}

async function inicializarTurno(sucursalId) {
    // Obtener prefijo de la sucursal
    const sucursalRes = await docClient.send(
        new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: sucursalId } })
    );
    const prefijo = sucursalRes.Item?.Prefijo || 'A';
    const hoy = fechaLocal();

    const item = {
        SucursalId: sucursalId,
        NumeroActual: 0,
        FechaUltimo: hoy,
        Prefijo: prefijo,
        VentanillasStatus: {},
        UltimoLlamado: null
    };
    await docClient.send(new UpdateCommand({
        TableName: TURNOS_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: 'SET NumeroActual = :n, UltimoGenerado = :n, FechaUltimo = :f, Prefijo = :p, VentanillasStatus = :vs, UltimoLlamado = :ul',
        ExpressionAttributeValues: {
            ':n': 0,
            ':f': hoy,
            ':p': prefijo,
            ':vs': {},
            ':ul': null
        },
    }));
    return item;
}

async function incrementoAtomico(sucursalId, hoy, ventanilla, nombreVendedor, limiteTurnos = 99) {
    const MAX_RETRIES = 5;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const current = await obtenerTurno(sucursalId);
            const prefijo = current.Prefijo || 'A';
            const numeroActual = current.NumeroActual || 0;
            const ultimoGenerado = current.UltimoGenerado || 0;

            // Validación de Cola: Si el actual ya alcanzó al generado, no hay más turnos.
            if (numeroActual === ultimoGenerado) {
                const error = new Error('No hay más turnos en cola esperando.');
                error.name = 'QueueEmptyException';
                throw error;
            }

            // Regla de incremento circular usando limite dinámico
            let nuevoNumero = numeroActual + 1;
            if (nuevoNumero > limiteTurnos) nuevoNumero = 0;

            const turnoFormateado = formatearTurno(prefijo, nuevoNumero, limiteTurnos);

            const ultimoLlamado = {
                Turno: turnoFormateado,
                Ventanilla: String(ventanilla),
                Vendedor: nombreVendedor,
                Timestamp: new Date().toISOString()
            };

            const ventanillasMap = current.VentanillasStatus || {};
            ventanillasMap[String(ventanilla)] = turnoFormateado;

            if (numeroActual < limiteTurnos) {
                // Incremento normal con bloqueo optimista
                const result = await docClient.send(new UpdateCommand({
                    TableName: TURNOS_TABLE,
                    Key: { SucursalId: sucursalId },
                    UpdateExpression: 'SET NumeroActual = NumeroActual + :uno, FechaUltimo = :hoy, UltimoLlamado = :ul, VentanillasStatus = :vs',
                    ExpressionAttributeValues: {
                        ':uno': 1,
                        ':hoy': hoy,
                        ':oldNumero': numeroActual,
                        ':ul': ultimoLlamado,
                        ':vs': ventanillasMap
                    },
                    ConditionExpression: 'NumeroActual = :oldNumero',
                    ReturnValues: 'ALL_NEW',
                }));
                return result.Attributes;
            } else {
                // Reset a 0 con bloqueo optimista
                const resetTurno = formatearTurno(prefijo, 0, limiteTurnos);
                ultimoLlamado.Turno = resetTurno;
                ventanillasMap[String(ventanilla)] = resetTurno;

                const result = await docClient.send(new UpdateCommand({
                    TableName: TURNOS_TABLE,
                    Key: { SucursalId: sucursalId },
                    UpdateExpression: 'SET NumeroActual = :cero, FechaUltimo = :hoy, UltimoLlamado = :ul, VentanillasStatus = :vs',
                    ExpressionAttributeValues: {
                        ':cero': 0,
                        ':hoy': hoy,
                        ':oldNumero': numeroActual,
                        ':ul': ultimoLlamado,
                        ':vs': ventanillasMap
                    },
                    ConditionExpression: 'NumeroActual = :oldNumero',
                    ReturnValues: 'ALL_NEW',
                }));
                return result.Attributes;
            }
        } catch (err) {
            if (err.name === 'QueueEmptyException') {
                throw err;
            }
            if (err.name === 'ConditionalCheckFailedException' && i < MAX_RETRIES - 1) {
                console.warn(`[Turnos] Colisión detectada en sucursal ${sucursalId}. Reintentando (${i + 1}/${MAX_RETRIES})...`);
                // Espera aleatoria para reducir probabilidad de nueva colisión
                await new Promise(r => setTimeout(r, Math.random() * 200));
                continue;
            }
            throw err;
        }
    }
    throw new Error('No se pudo generar el turno debido a alta concurrencia. Intente de nuevo.');
}

async function resetearTurnoDiario(sucursalId, hoy, prefijo) {
    const result = await docClient.send(new UpdateCommand({
        TableName: TURNOS_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: 'SET NumeroActual = :cero, UltimoGenerado = :cero, FechaUltimo = :hoy, Prefijo = :p, VentanillasStatus = :vs, UltimoLlamado = :ul',
        ExpressionAttributeValues: {
            ':cero': 0,
            ':hoy': hoy,
            ':p': prefijo || 'A',
            ':vs': {},
            ':ul': null
        },
        ReturnValues: 'ALL_NEW',
    }));
    return { ...result.Attributes, _reiniciado: true };
}

// REMOVED old formatearTurno since it's now at the top of the file.

// Fecha local en formato YYYY-MM-DD (usando zona horaria del servidor)
function fechaLocal() {
    return new Date().toISOString().split('T')[0];
}
