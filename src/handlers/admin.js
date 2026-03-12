'use strict';

const { docClient } = require('../utils/dynamodb');
const { v4: uuidv4 } = require('uuid');
const {
    ScanCommand,
    GetCommand,
    PutCommand,
    DeleteCommand,
    UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
    CognitoIdentityProviderClient,
    AdminCreateUserCommand,
    AdminDeleteUserCommand,
    AdminUpdateUserAttributesCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.REGION || 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;

const SUCURSALES_TABLE = process.env.SUCURSALES_TABLE || 'Sucursales';
const VENDEDORES_TABLE = process.env.VENDEDORES_TABLE || 'Vendedores';
const TURNOS_TABLE = process.env.TURNOS_TABLE || 'Turnos';
const CODIGOS_SETUP_TABLE = process.env.CODIGOS_SETUP_TABLE || 'CodigosSetup';

// ─── Helpers ────────────────────────────────────────────────────────────────

const response = (statusCode, body, headers = {}) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        ...headers,
    },
    body: JSON.stringify(body),
});

const ok = (data) => response(200, { success: true, data });
const created = (data) => response(201, { success: true, data });
const badRequest = (msg) => response(400, { success: false, error: msg });
const notFound = (msg) => response(404, { success: false, error: msg });
const serverError = (err) => {
    console.error('[AdminHandler] Error:', err);
    return response(500, { success: false, error: 'Error interno del servidor' });
};

// ─── Handler Principal ────────────────────────────────────────────────────────

exports.handler = async (event) => {
    const { httpMethod, path, pathParameters, body: rawBody } = event;
    const body = rawBody ? JSON.parse(rawBody) : {};

    console.info(`[Admin] ${httpMethod} ${path}`);

    try {
        // OPTIONS pre-flight
        if (httpMethod === 'OPTIONS') return response(200, {});

        // ── SUCURSALES ──────────────────────────────────────────────────────────

        if (path === '/sucursales' && httpMethod === 'GET') {
            return await getSucursales();
        }

        if (path === '/sucursales/identificar' && httpMethod === 'GET') {
            return await identificarSucursal(event);
        }

        if (path === '/sucursales' && httpMethod === 'POST') {
            return await createSucursal(body);
        }

        if (path.startsWith('/sucursales/') && httpMethod === 'PUT') {
            return await updateSucursal(pathParameters?.id, body);
        }

        if (path.startsWith('/sucursales/') && httpMethod === 'DELETE') {
            return await deleteSucursal(pathParameters?.id);
        }

        // ── VENDEDORES ──────────────────────────────────────────────────────────

        if (path === '/vendedores' && httpMethod === 'GET') {
            return await getVendedores();
        }

        if (path === '/vendedores' && httpMethod === 'POST') {
            return await createVendedor(body);
        }

        if (path.startsWith('/vendedores/') && path.endsWith('/setup-link') && httpMethod === 'POST') {
            return await generateSetupLink(pathParameters?.id);
        }

        if (path.startsWith('/vendedores/') && httpMethod === 'PUT') {
            return await updateVendedor(pathParameters?.id, body);
        }

        if (path.startsWith('/vendedores/') && httpMethod === 'DELETE') {
            return await deleteVendedor(pathParameters?.id);
        }

        return notFound('Ruta no encontrada');
    } catch (err) {
        return serverError(err);
    }
};

// ─── Sucursales ──────────────────────────────────────────────────────────────

async function getSucursales() {
    const result = await docClient.send(new ScanCommand({ TableName: SUCURSALES_TABLE }));
    return ok(result.Items || []);
}

async function createSucursal(body) {
    const { Nombre, IP_Fija, Prefijo, LimiteTurnos } = body;
    if (!Nombre) return badRequest('El nombre de la sucursal es requerido');

    // Generación de ID consecutivo
    const allSucursalesRes = await docClient.send(new ScanCommand({ TableName: SUCURSALES_TABLE }));
    const sucursales = allSucursalesRes.Items || [];
    let maxId = 0;

    sucursales.forEach(s => {
        // Extraemos solo los IDs que son puramente numéricos
        const num = Number(s.SucursalId);
        if (!isNaN(num)) {
            if (num > maxId) maxId = num;
        }
    });

    const nextId = maxId + 1;
    const sucursalId = nextId.toString().padStart(2, '0');
    const sucursal = {
        SucursalId: sucursalId,
        Nombre,
        IP_Fija: IP_Fija || '',
        Prefijo: (Prefijo || 'A').toUpperCase(),
        LimiteTurnos: LimiteTurnos ? parseInt(LimiteTurnos, 10) : 99,
        Estado: 'activa',
        CreadaEn: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({ TableName: SUCURSALES_TABLE, Item: sucursal }));
    return created(sucursal);
}

async function identificarSucursal(event) {
    // API Gateway proporciona la IP en event.requestContext.identity.sourceIp
    // Pero si hay CloudFront, hay que revisar headers como x-forwarded-for
    const clientIp = event.requestContext?.identity?.sourceIp ||
        event.headers?.['x-forwarded-for']?.split(',')[0]?.trim();

    console.info(`[Admin] Identificando sucursal para IP: ${clientIp}`);

    if (!clientIp) return badRequest('No se pudo determinar la dirección IP del cliente');

    const result = await docClient.send(new ScanCommand({ TableName: SUCURSALES_TABLE }));
    const sucursales = result.Items || [];

    // Buscar sucursal que coincida con la IP
    const sucursal = sucursales.find(s => s.IP_Fija === clientIp);

    if (!sucursal) {
        return notFound(`No se encontró ninguna sucursal configurada con la IP: ${clientIp}`);
    }

    return ok({
        SucursalId: sucursal.SucursalId,
        Nombre: sucursal.Nombre,
        IP: clientIp
    });
}

async function updateSucursal(sucursalId, body) {
    if (!sucursalId) return badRequest('SucursalId requerido');

    const { Nombre, IP_Fija, Prefijo, Estado, LimiteTurnos } = body;
    const expressions = [];
    const names = {};
    const values = {};

    if (Nombre) {
        expressions.push('#n = :n');
        names['#n'] = 'Nombre';
        values[':n'] = Nombre;
    }
    if (IP_Fija !== undefined) {
        expressions.push('#ip = :ip');
        names['#ip'] = 'IP_Fija';
        values[':ip'] = IP_Fija;
    }
    if (Prefijo !== undefined) {
        expressions.push('#p = :p');
        names['#p'] = 'Prefijo';
        values[':p'] = Prefijo;
    }
    if (Estado) {
        expressions.push('#e = :e');
        names['#e'] = 'Estado';
        values[':e'] = Estado;
    }
    if (LimiteTurnos !== undefined) {
        expressions.push('#lt = :lt');
        names['#lt'] = 'LimiteTurnos';
        values[':lt'] = parseInt(LimiteTurnos, 10);
    }

    if (!expressions.length) return badRequest('No hay campos para actualizar');

    values[':ua'] = new Date().toISOString();
    expressions.push('ActualizadoEn = :ua');

    await docClient.send(new UpdateCommand({
        TableName: SUCURSALES_TABLE,
        Key: { SucursalId: sucursalId },
        UpdateExpression: `SET ${expressions.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
    }));

    return ok({ SucursalId: sucursalId, ...body });
}

async function deleteSucursal(sucursalId) {
    if (!sucursalId) return badRequest('SucursalId requerido');

    // Borrado en cascada (Opcional pero recomendado para limpieza)
    // 1. Borrar sucursal
    await docClient.send(new DeleteCommand({
        TableName: SUCURSALES_TABLE,
        Key: { SucursalId: sucursalId },
    }));

    // 2. Borrar turnos asociados
    try {
        await docClient.send(new DeleteCommand({
            TableName: TURNOS_TABLE,
            Key: { SucursalId: sucursalId },
        }));
    } catch (e) {
        console.warn(`[Admin] No se pudo borrar el registro de turnos para ${sucursalId}:`, e.message);
    }

    return ok({ deleted: true, SucursalId: sucursalId });
}

// ─── Vendedores ──────────────────────────────────────────────────────────────

async function getVendedores() {
    // Obtiene vendedores con datos de su sucursal
    const [vendedoresRes, sucursalesRes] = await Promise.all([
        docClient.send(new ScanCommand({ TableName: VENDEDORES_TABLE })),
        docClient.send(new ScanCommand({ TableName: SUCURSALES_TABLE })),
    ]);

    const sucursalesMap = {};
    (sucursalesRes.Items || []).forEach((s) => {
        sucursalesMap[s.SucursalId] = s;
    });

    const vendedores = (vendedoresRes.Items || []).map((v) => ({
        ...v,
        Sucursal: sucursalesMap[v.SucursalId] || null,
    }));

    return ok(vendedores);
}

async function createVendedor(body) {
    const { Nombre, Email, SucursalId, Ventanilla, Rol } = body;
    if (!Nombre || !Email) return badRequest('Nombre y Email son requeridos');
    if (!SucursalId && Rol !== 'admin') return badRequest('SucursalId requerido para vendedores');

    const assignedSucursalId = Rol === 'admin' ? 'TODAS' : SucursalId;
    const finalRole = Rol === 'admin' ? 'admin' : 'vendedor';

    // Verificar que la sucursal existe (solo si no es admin)
    let sucursalItem = null;
    if (finalRole !== 'admin') {
        const sucursalRes = await docClient.send(
            new GetCommand({ TableName: SUCURSALES_TABLE, Key: { SucursalId: assignedSucursalId } })
        );
        if (!sucursalRes.Item) return notFound(`Sucursal ${assignedSucursalId} no encontrada`);
        sucursalItem = sucursalRes.Item;
    }

    const vendedorId = uuidv4();
    const vendedor = {
        VendedorId: vendedorId,
        Nombre,
        Email,
        SucursalId: assignedSucursalId,
        Ventanilla: Ventanilla || '0',
        Estado: 'activo',
        Role: finalRole,
        CreadoEn: new Date().toISOString(),
    };

    // 1. Guardar en DynamoDB
    await docClient.send(new PutCommand({ TableName: VENDEDORES_TABLE, Item: vendedor }));

    // 2. Crear usuario en Cognito (si estamos en AWS)
    if (USER_POOL_ID) {
        try {
            await cognitoClient.send(new AdminCreateUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: Email,
                UserAttributes: [
                    { Name: 'email', Value: Email },
                    { Name: 'email_verified', Value: 'true' },
                    { Name: 'custom:sucursalId', Value: assignedSucursalId },
                    { Name: 'custom:ventanilla', Value: Ventanilla || '0' },
                    { Name: 'custom:role', Value: finalRole }
                ],
                DesiredDeliveryMediums: ['EMAIL']
            }));
        } catch (cognitoErr) {
            console.error('[Admin] Error creando usuario en Cognito:', cognitoErr);
            // Si el usuario ya existe, podríamos ignorarlo o reportarlo
            if (cognitoErr.name !== 'UsernameExistsException') {
                throw cognitoErr;
            }
        }
    }

    return created({ ...vendedor, Sucursal: sucursalItem });
}

async function updateVendedor(vendedorId, body) {
    if (!vendedorId) return badRequest('VendedorId requerido');

    const { Nombre, SucursalId, Ventanilla, Estado } = body;
    const expressions = [];
    const names = {};
    const values = {};
    const cognitoAttrs = [];

    if (Nombre) {
        expressions.push('#n = :n');
        names['#n'] = 'Nombre';
        values[':n'] = Nombre;
    }
    if (SucursalId) {
        expressions.push('#sid = :sid');
        names['#sid'] = 'SucursalId';
        values[':sid'] = SucursalId;
        cognitoAttrs.push({ Name: 'custom:sucursalId', Value: SucursalId });
    }
    if (Ventanilla !== undefined) {
        expressions.push('#v = :v');
        names['#v'] = 'Ventanilla';
        values[':v'] = Ventanilla;
        cognitoAttrs.push({ Name: 'custom:ventanilla', Value: String(Ventanilla) });
    }
    if (Estado) {
        expressions.push('#e = :e');
        names['#e'] = 'Estado';
        values[':e'] = Estado;
    }

    if (!expressions.length) return badRequest('No hay campos para actualizar');

    // 1. Obtener datos actuales para Cognito (se necesita el email)
    const vRes = await docClient.send(new GetCommand({ TableName: VENDEDORES_TABLE, Key: { VendedorId: vendedorId } }));
    if (!vRes.Item) return notFound('Vendedor no encontrado');

    // 2. Actualizar en DynamoDB
    await docClient.send(new UpdateCommand({
        TableName: VENDEDORES_TABLE,
        Key: { VendedorId: vendedorId },
        UpdateExpression: `SET ${expressions.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
    }));

    // 3. Actualizar en Cognito si hay cambios relevantes
    if (cognitoAttrs.length > 0 && USER_POOL_ID) {
        try {
            await cognitoClient.send(new AdminUpdateUserAttributesCommand({
                UserPoolId: USER_POOL_ID,
                Username: vRes.Item.Email,
                UserAttributes: cognitoAttrs
            }));
        } catch (err) {
            console.error('[Admin] Error actualizando Cognito:', err);
        }
    }

    return ok({ VendedorId: vendedorId, ...body });
}

async function deleteVendedor(vendedorId) {
    if (!vendedorId) return badRequest('VendedorId requerido');

    // Obtener el email del vendedor antes de borrarlo para borrarlo de Cognito también
    const vRes = await docClient.send(new GetCommand({ TableName: VENDEDORES_TABLE, Key: { VendedorId: vendedorId } }));

    await docClient.send(new DeleteCommand({
        TableName: VENDEDORES_TABLE,
        Key: { VendedorId: vendedorId },
    }));

    if (vRes.Item && vRes.Item.Email && USER_POOL_ID) {
        try {
            await cognitoClient.send(new AdminDeleteUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: vRes.Item.Email
            }));
        } catch (err) {
            console.error('[Admin] Error borrando de Cognito:', err);
        }
    }

    return ok({ deleted: true, VendedorId: vendedorId });
}

async function generateSetupLink(vendedorId) {
    if (!vendedorId) return badRequest('VendedorId requerido');

    // Verificar que el vendedor existe
    const vendedorRes = await docClient.send(
        new GetCommand({ TableName: VENDEDORES_TABLE, Key: { VendedorId: vendedorId } })
    );
    if (!vendedorRes.Item) return notFound(`Vendedor ${vendedorId} no encontrado`);

    // Generar código único UUID y TTL de 7 días
    const codigo = uuidv4().replace(/-/g, '').toUpperCase();
    const ttlSeconds = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const baseUrl = process.env.FRONTEND_URL || 'https://fila-virtual.s3.amazonaws.com';

    await docClient.send(new PutCommand({
        TableName: CODIGOS_SETUP_TABLE,
        Item: {
            Codigo: codigo,
            VendedorId: vendedorId,
            Nombre: vendedorRes.Item.Nombre,
            Email: vendedorRes.Item.Email,
            SucursalId: vendedorRes.Item.SucursalId,
            Ventanilla: vendedorRes.Item.Ventanilla || '0',
            Usado: false,
            CreadoEn: new Date().toISOString(),
            TTL: ttlSeconds,
        },
    }));

    const setupUrl = `${baseUrl}/setup/index.html?code=${codigo}`;
    return ok({
        codigo,
        setupUrl,
        expiresIn: '7 días',
        vendedor: {
            VendedorId: vendedorId,
            Nombre: vendedorRes.Item.Nombre,
            Email: vendedorRes.Item.Email,
        },
    });
}
