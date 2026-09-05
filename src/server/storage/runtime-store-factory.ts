import { CosmosClient, type Container, type ItemDefinition, type SqlQuerySpec } from '@azure/cosmos';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

import {
  CosmosRuntimeStore,
  type CosmosPortResult,
  type CosmosRuntimeContainerPort,
} from './cosmos-runtime-store.js';
import type { RuntimeRecordDocument, RuntimeStore } from './runtime-store.js';

type CosmosStoredDocument = RuntimeRecordDocument & { _etag?: string };

type RuntimeEnvironment = Record<string, string | undefined>;

export type RuntimeStoreFactoryOptions = {
  env: RuntimeEnvironment;
  fileStore: RuntimeStore;
  createDefaultAzureCredential?: () => TokenCredential;
  createCosmosContainer?: (options: {
    endpoint: string;
    databaseId: string;
    containerId: string;
    credential: TokenCredential;
  }) => CosmosRuntimeContainerPort;
};

export async function createRuntimeStore(options: RuntimeStoreFactoryOptions): Promise<RuntimeStore> {
  const backend = options.env.TEAMS_STORAGE_BACKEND?.trim().toLowerCase() || 'file';
  if (backend === 'file') return options.fileStore;
  if (backend !== 'cosmos') throw new Error(`unsupported storage backend: ${backend}`);

  for (const [key, value] of Object.entries(options.env)) {
    const normalizedKey = key.toUpperCase();
    if (
      value?.trim() &&
      normalizedKey.includes('COSMOS') &&
      (normalizedKey.includes('KEY') || normalizedKey.includes('CONNECTION_STRING') || normalizedKey.includes('CONNECTIONSTRING'))
    ) {
      throw new Error(`Cosmos connection strings and key-based authentication are forbidden: ${key}`);
    }
  }

  const endpoint = requireSetting(options.env, 'AZURE_COSMOS_ENDPOINT');
  const databaseId = requireSetting(options.env, 'AZURE_COSMOS_DATABASE');
  const containerId = requireSetting(options.env, 'AZURE_COSMOS_CONTAINER');
  assertCosmosEndpoint(endpoint);

  const credential = (options.createDefaultAzureCredential ?? (() => new DefaultAzureCredential()))();
  const container = (options.createCosmosContainer ?? createAzureCosmosContainer)({
    endpoint,
    databaseId,
    containerId,
    credential,
  });
  return new CosmosRuntimeStore({ container });
}

function createAzureCosmosContainer(options: {
  endpoint: string;
  databaseId: string;
  containerId: string;
  credential: TokenCredential;
}): CosmosRuntimeContainerPort {
  const client = new CosmosClient({ endpoint: options.endpoint, aadCredentials: options.credential });
  const container = client.database(options.databaseId).container(options.containerId);
  return createCosmosContainerPort(container);
}

export function createCosmosContainerPort(container: Container): CosmosRuntimeContainerPort {
  return {
    async read(id, partitionKey) {
      try {
        const response = await container.item(id, partitionKey).read<RuntimeRecordDocument>();
        if (!response.resource) return null;
        return toPortResult(response.resource, response.etag);
      } catch (error) {
        if (hasStatusCode(error, 404)) return null;
        throw error;
      }
    },
    async create(document) {
      const response = await container.items.create(document as ItemDefinition, { disableAutomaticIdGeneration: true });
      if (!response.resource) throw new Error('Cosmos create returned no runtime record');
      return toPortResult(response.resource as unknown as RuntimeRecordDocument, response.etag);
    },
    async replace(id, partitionKey, document, ifMatch) {
      const response = await container.item(id, partitionKey).replace(document, {
        accessCondition: { type: 'IfMatch', condition: ifMatch },
      });
      if (!response.resource) throw new Error('Cosmos replace returned no runtime record');
      return toPortResult(response.resource as unknown as RuntimeRecordDocument, response.etag);
    },
    async queryPartition(partitionKey, limit) {
      const query: SqlQuerySpec = {
        query: 'SELECT TOP @limit * FROM c WHERE c.partitionKey = @partitionKey ORDER BY c.updatedAt DESC',
        parameters: [
          { name: '@limit', value: limit },
          { name: '@partitionKey', value: partitionKey },
        ],
      };
      const response = await container.items
        .query<CosmosStoredDocument>(query, { partitionKey, maxItemCount: limit })
        .fetchAll();
      return response.resources.map((document) => toPortResult(document, document._etag));
    },
  };
}

function toPortResult(document: RuntimeRecordDocument, etag: string | undefined): CosmosPortResult {
  if (!etag) throw new Error('Cosmos response did not include an ETag');
  return { document: { ...document, etag }, etag };
}

function requireSetting(env: RuntimeEnvironment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for Cosmos runtime storage`);
  return value;
}

function assertCosmosEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('AZURE_COSMOS_ENDPOINT must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('AZURE_COSMOS_ENDPOINT must be a credential-free HTTPS URL');
  }
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === statusCode);
}
