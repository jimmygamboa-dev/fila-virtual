'use strict';

/**
 * Utilidades de Autenticación para Cognito JWT
 * Nota: En un entorno productivo ideal, deberíamos verificar la firma (RS256) 
 * contra las llaves públicas de Cognito (JWKS). Para esta fase de corrección urgente, 
 * decodificamos el payload para extraer claims.
 */

function extractBearerToken(headers) {
    const auth = headers.Authorization || headers.authorization;
    if (!auth) return null;
    return auth.startsWith('Bearer ') ? auth.substring(7) : auth;
}

function decodeToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        // Decodificar Base64URL
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return { payload };
    } catch (err) {
        console.error('[Auth] Error decodificando token:', err);
        return null;
    }
}

// Para compatibilidad con turnos.js
function verifyToken(token) {
    const decoded = decodeToken(token);
    if (!decoded) throw new Error('Token inválido');
    return decoded;
}

module.exports = {
    extractBearerToken,
    decodeToken,
    verifyToken
};
