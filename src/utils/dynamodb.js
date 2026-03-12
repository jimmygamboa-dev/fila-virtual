'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

/**
 * Detecta si estamos en entorno local (SAM local o tests)
 * y configura el cliente DynamoDB apuntando a DynamoDB Local (puerto 8000)
 */
const isLocal =
  process.env.AWS_SAM_LOCAL === 'true' ||
  !!process.env.DYNAMODB_ENDPOINT;

const clientConfig = {
  region: process.env.REGION || process.env.AWS_REGION || 'us-east-1',
};

if (isLocal) {
  const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
  clientConfig.endpoint = endpoint;
  clientConfig.credentials = {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  };
  console.info(`[DynamoDB] Modo LOCAL → ${endpoint}`);
}

const rawClient = new DynamoDBClient(clientConfig);

// DocumentClient simplifica las operaciones eliminando los tipos DynamoDB ({S: "..."})
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

module.exports = { docClient };
