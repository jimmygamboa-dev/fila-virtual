'use strict';

const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const pollyClient = new PollyClient({ region: process.env.REGION || 'us-east-1' });

exports.handler = async (event) => {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS'
                },
                body: ''
            };
        }

        const text = event.queryStringParameters?.text;
        if (!text) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Falta texto' })
            };
        }

        const command = new SynthesizeSpeechCommand({
            Text: text,
            OutputFormat: 'mp3',
            VoiceId: 'Conchita',
            LanguageCode: 'es-ES',
            Engine: 'standard'
        });

        const { AudioStream } = await pollyClient.send(command);
        
        // Convertir stream a Buffer
        const chunks = [];
        for await (const chunk of AudioStream) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);

        // Retornamos JSON con base64 para EVITAR problemas de BinaryMediaTypes en API Gateway
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                audio: audioBuffer.toString('base64'),
                format: 'mp3'
            })
        };

    } catch (err) {
        console.error('[TTS] Error:', err);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
