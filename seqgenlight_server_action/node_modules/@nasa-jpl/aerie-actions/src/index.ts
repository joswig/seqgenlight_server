import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import type { PoolClient, QueryResult } from 'pg';
import { adaptationQuery, dictionaryQuery, queryReadParcel } from './helpers/db-helpers';
import { ActionsConfig } from './types';
import {
  FileMetadata,
  FileMetadataWritable,
  FileMetadataWriteResult,
  ReadDictionaryResult,
  ReadParcelResult,
} from './types/db-types';
export * from './types';

// codemirror dependencies to be passed to user sequencing adaptation, if loaded
import * as cmLanguage from '@codemirror/language';
import * as cmState from '@codemirror/state';

/**
 * Reads a Channel Dictionary for a given `id`.
 *
 * @param dbClient - A client that is part of our connection pool.
 * @param id - The id of the Channel Dictionary.
 * @returns The Channel Dictionary with the given ID
 */
export function queryReadChannelDictionary(
  dbClient: PoolClient,
  id: number,
): Promise<QueryResult<ReadDictionaryResult>> {
  return dbClient.query(dictionaryQuery('channel_dictionary'), [id]);
}

/**
 * Reads a Command Dictionary for a given `id`.
 *
 * @param dbClient - A client that is part of our connection pool.
 * @param id - The id of the Command Dictionary.
 * @returns The Command Dictionary with the given ID
 */
export function queryReadCommandDictionary(
  dbClient: PoolClient,
  id: number,
): Promise<QueryResult<ReadDictionaryResult>> {
  return dbClient.query(dictionaryQuery('command_dictionary'), [id]);
}

/**
 * Reads a Parameter Dictionary for a given `id`.
 *
 * @param dbClient - A client that is part of our connection pool.
 * @param id - The id of the Parameter Dictionary.
 * @returns The Parameter Dictionary with the given ID
 */
export function queryReadParameterDictionary(
  dbClient: PoolClient,
  id: number,
): Promise<QueryResult<ReadDictionaryResult>> {
  return dbClient.query(dictionaryQuery('parameter_dictionary'), [id]);
}

export type ListFilesOptions = {
  withMetadata?: boolean;
};
export type SetFileMetadataOptions = {
  mergeBehavior?: 'deep' | 'shallow' | 'overwrite';
};

// Main API class used by the user's action
export class ActionsAPI {
  config: ActionsConfig;
  dbClient: PoolClient;
  workspaceId: number;

  ACTION_FILE_STORE: string;
  SEQUENCING_FILE_STORE: string;
  WORKSPACE_BASE_URL: string;

  static ENVIRONMENT_VARIABLE_PREFIX = 'PUBLIC_ACTION_';

  /**
   *
   * @param dbClient - A client that is part of our connection pool.
   * @param workspaceId - The id of the Workspace the Action is associated with.
   * @param config - A config containing an `ACTION_FILE_STORE`, `SEQUENCING_FILE_STORE`, and `WORKSPACE_BASE_URL`
   * so the action can read files.
   */
  constructor(dbClient: PoolClient, workspaceId: number, config: ActionsConfig) {
    this.dbClient = dbClient;
    this.workspaceId = workspaceId;
    this.config = config;

    this.ACTION_FILE_STORE = config.ACTION_FILE_STORE;
    this.SEQUENCING_FILE_STORE = config.SEQUENCING_FILE_STORE;
    this.WORKSPACE_BASE_URL = config.WORKSPACE_BASE_URL;
  }

  /**
   * Finds an environment variable by name if it is prefixed with `PUBLIC_ACTION_`.
   *
   * @param name The name of the environment variable.
   * @returns The value of the environment variable if it was found, otherwise undefined.
   */

  getEnvironmentVariable(name: string): string | undefined {
    if (name.startsWith(ActionsAPI.ENVIRONMENT_VARIABLE_PREFIX)) {
      return process.env[name];
    } else {
      console.warn(
        `Only environment variables with the prefix: ${ActionsAPI.ENVIRONMENT_VARIABLE_PREFIX} can be accessed from within an action.`,
      );
    }

    return undefined;
  }

  /**
   * A helper method to perform GET, PUT, and POST methods on the workspace endpoint.
   * @param path - URL path to be queried
   * @param method - URL method to be used (GET, PUT, POST)
   * @param body - Request body, if needed.
   * @returns The response body as a string.
   * @private
   */
  private async reqWorkspace(path: string, method: string, body: any | null = null): Promise<string> {
    if (!this.WORKSPACE_BASE_URL) {
      throw new Error('WORKSPACE_BASE_URL not configured');
    }

    const headers: HeadersInit = {};
    if (this.config.SECRETS?.authorization) {
      headers['authorization'] = this.config.SECRETS.authorization;
      if (this.config.USER_ROLE) {
        headers['x-hasura-role'] = this.config.USER_ROLE;
      }
    } else {
      throw new Error(
        'Missing user authorization token from config.SECRETS.authorization - unable to send workspace request',
      );
    }
    const methodsWithBody = ['POST', 'PUT'];
    let requestBody: BodyInit | undefined = undefined;

    if (body !== null && methodsWithBody.includes(method.toUpperCase())) {
      if (body instanceof FormData) {
        // Let fetch set Content-Type
        requestBody = body;
      } else {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      }
    }

    const options: RequestInit = {
      method,
      headers,
      body: requestBody,
    };

    const response = await fetch(`${this.WORKSPACE_BASE_URL}${path}`, options);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${response.status} - ${text}`);
    }

    return text;
  }

  /**
   * List files in the workspace at the given path.
   * @param path - The path of the given workspace context to query
   * @param options - Options controlling the listing (e.g. `withMetadata`).
   * @returns The workspace listing as a string.
   */
  async listFiles(path: string, options: ListFilesOptions = {}): Promise<string> {
    // HTTP backend - fetch workspace contents
    // Example endpoint: GET /ws/:workspaceId
    let fullPath = `/ws/${this.workspaceId}/${encodeURIComponent(path)}`;
    if (options.withMetadata) {
      fullPath += `?withMetadata=true`;
    }
    const data = await this.reqWorkspace(fullPath, 'GET', null);
    if (!data) throw new Error(`Contents for workspace ${this.workspaceId} not found`);
    return data;
  }

  /**
   * Read a single file's contents in the given workspace.
   * @param path - The path of the given workspace context to query
   * @returns The file contents as a string.
   */
  async readFile(path: string): Promise<string> {
    // HTTP backend - fetch sequence file by name
    // Example endpoint: GET /ws/:workspaceId/:name
    const fullPath = `/ws/${this.workspaceId}/${encodeURIComponent(path)}`;
    const data = await this.reqWorkspace(fullPath, 'GET', '{}');
    // Intentionally not using `if (!data)` here, as empty string is falsy
    if (data === null || data === undefined) {
      throw new Error(`File ${path} not found`);
    }
    return data;
  }

  /**
   * Write a file with the given name and definition to the workspace filesystem.
   * @param name - Full path of the file from the workspace root. This functions like mkdir -p; if parent folders
   * do not exist, they will be created.
   * @param contents - The contents of the file to be written.
   * @param overwrite - If the file already exists, overwrite its contents.
   * @returns An object indicating success.
   */
  async writeFile(name: string, contents: string, overwrite: boolean = false): Promise<{ success: true }> {
    // Example: PUT /ws/:workspaceId/:name
    // Strip path, keep only the file name
    const filenameOnly = name.split(/[/\\]/).pop()!;

    const formData = new FormData();
    formData.append('file', new Blob([contents]), filenameOnly);
    const path = `/ws/${this.workspaceId}/${encodeURIComponent(name)}?type=file&overwrite=${overwrite}`;
    await this.reqWorkspace(path, 'PUT', formData);
    return { success: true };
  }

  /**
   * Copy a file within the workspace to a new location.
   * @param source - Source path of the file
   * @param dest - Destination path of the file.
   * @returns An object indicating success.
   */
  async copyFile(source: string, dest: string): Promise<{ success: true }> {
    const sourcePath = `/ws/${this.workspaceId}/${encodeURIComponent(source)}`;
    await this.reqWorkspace(sourcePath, 'POST', { copyTo: dest });
    return { success: true };
  }

  /**
   * Move a file within the workspace to a new location.
   * @param source - Source path of the file
   * @param dest - Destination path of the file.
   * @returns An object indicating success.
   */
  async moveFile(source: string, dest: string): Promise<{ success: true }> {
    const sourcePath = `/ws/${this.workspaceId}/${encodeURIComponent(source)}`;
    await this.reqWorkspace(sourcePath, 'POST', { moveTo: dest });
    return { success: true };
  }

  /**
   * Delete a file or directory within the workspace to a new location.
   * @param source - Source path of the file or directory.
   * @returns An object indicating success.
   */
  async deleteFile(source: string): Promise<{ success: true }> {
    const sourcePath = `/ws/${this.workspaceId}/${encodeURIComponent(source)}`;
    await this.reqWorkspace(sourcePath, 'DELETE', {});
    return { success: true };
  }

  /**
   * Create a new directory in the given workspace filesystem.
   * @param name - Name/path of the new directory.  This functions like mkdir -p; if parent folders
   * do not exist, they will be created. If a directory already exists, it will be skipped.
   * @returns An object indicating success.
   */
  async createDirectory(name: string): Promise<{ success: true }> {
    // Example: PUT /ws/:workspaceId/:name
    const path = `/ws/${this.workspaceId}/${encodeURIComponent(name)}?type=directory`;
    await this.reqWorkspace(path, 'PUT', '{}');
    return { success: true };
  }

  /**
   * Create a new set of directories in the given workspace filesystem. Alias for createDirectory.
   * @param name - Name/path of the new directory.  This functions like mkdir -p; if parent folders
   * do not exist, they will be created. If a directory already exists, it will be skipped.
   * @returns An object indicating success.
   */
  async createDirectories(name: string): Promise<{ success: true }> {
    return await this.createDirectory(name);
  }

  /**
   * Get metadata about an existing file
   * @param filePath - Path to an existing file in the workspace
   * @returns The parsed metadata object for the file.
   */
  async getFileMetadata(filePath: string): Promise<FileMetadata> {
    const apiPath = `/metadata/${this.workspaceId}/${encodeURIComponent(filePath)}`;
    const metadata = await this.reqWorkspace(apiPath, 'GET', {});
    return JSON.parse(metadata);
  }

  /**
   * Set metadata values for a file. allowed: readonly, user object
   * @param filePath - Path to an existing file in the workspace.
   * @param metadata - Metadata values to set on the file.
   * @param options - Options controlling how the metadata is merged (`deep`, `shallow`, or `overwrite`).
   * @returns An object indicating success and including the raw server response.
   */
  async setFileMetadata(
    filePath: string,
    metadata: FileMetadataWritable,
    options: SetFileMetadataOptions = {},
  ): Promise<FileMetadataWriteResult> {
    let apiPath = `/metadata/${this.workspaceId}/${encodeURIComponent(filePath)}`;
    if (options.mergeBehavior) {
      apiPath += `?mergeBehavior=${options.mergeBehavior}`;
    }
    const response = await this.reqWorkspace(apiPath, 'POST', metadata);
    return { success: true, response: response };
  }

  /**
   * Unset metadata values for a file. allowed: readonly, user object
   * @param filePath - Path to an existing file in the workspace.
   * @param keys - The metadata keys to unset.
   * @returns An object indicating success and including the raw server response.
   */
  async unsetFileMetadata(filePath: string, keys: string[]): Promise<FileMetadataWriteResult> {
    const apiPath = `/metadata/unset/${this.workspaceId}/${encodeURIComponent(filePath)}`;
    const response = await this.reqWorkspace(apiPath, 'POST', keys);
    return { success: true, response: response };
  }

  /**
   * Delete all metadata for a file
   * @param filePath - Path to an existing file in the workspace.
   * @returns An object indicating success and including the raw server response.
   */
  async deleteFileMetadata(filePath: string): Promise<FileMetadataWriteResult> {
    const apiPath = `/metadata/${this.workspaceId}/${encodeURIComponent(filePath)}`;
    const response = await this.reqWorkspace(apiPath, 'DELETE', {});
    return { success: true, response: response };
  }

  /**
   * Reads a Channel Dictionary from the database.
   *
   * @param id - The id of the Channel Dictionary.
   * @returns The Channel Dictionary with the given ID
   */
  async readChannelDictionary(id: number): Promise<ReadDictionaryResult> {
    const result = await queryReadChannelDictionary(this.dbClient, id);
    const rows = result.rows;

    if (!rows.length) {
      throw new Error(`Channel Dictionary with id: ${id} does not exist`);
    }

    return rows[0];
  }

  /**
   * Reads a Command Dictionary from the database.
   *
   * @param id - The id of the Command Dictionary.
   * @returns The Command Dictionary with the given ID
   */
  async readCommandDictionary(id: number): Promise<ReadDictionaryResult> {
    const result = await queryReadCommandDictionary(this.dbClient, id);
    const rows = result.rows;

    if (!rows.length) {
      throw new Error(`Command Dictionary with id: ${id} does not exist`);
    }

    return rows[0];
  }

  /**
   * Reads a Parameter Dictionary from the database.
   *
   * @param id - The id of the Parameter Dictionary.
   * @returns The Parameter Dictionary with the given ID
   */
  async readParameterDictionary(id: number): Promise<ReadDictionaryResult> {
    const result = await queryReadParameterDictionary(this.dbClient, id);
    const rows = result.rows;

    if (!rows.length) {
      throw new Error(`Parameter Dictionary with id: ${id} does not exist`);
    }

    return rows[0];
  }

  /**
   * Reads the file contents from file given a path to that file. The path is sanitized so the requester cannot
   * look outside of the file store.
   *
   * @param filePath - The path to the file.
   * @returns The file contents as a string.
   */
  async readDictionaryFile(filePath: string): Promise<string> {
    return await readFile(
      `${filePath.replace(this.config.SEQUENCING_FILE_STORE, this.config.ACTION_FILE_STORE)}`,
      'utf-8',
    );
  }

  /**
   * Reads a Parcel for the current workspace.
   *
   * @returns The parcel detail, including ids for dictionaries it contains
   */
  async readParcel(): Promise<ReadParcelResult> {
    const result = await queryReadParcel(this.dbClient!, this.workspaceId);
    const rows = result.rows;

    if (!rows.length) {
      throw new Error(`Could not find parcel for workspace id ${this.workspaceId}`);
    }

    return rows[0];
  }

  /**
   * Load the JS sequence adaptation for the current workspace from the DB,
   * execute it within a VM JS context,
   * and return it as a JS object with functions that can be executed by the action
   *
   * @returns Promise which resolves to the loaded sequence adaptation JS object
   */
  async loadAdaptation(): Promise<any> {
    // todo: type the return value from this, get type from aerie-sequence-languages library?
    // lookup workspace's parcel and get its sequence adaptation ID
    const parcel = await this.readParcel();
    const adaptationId = parcel.sequence_adaptation_id;
    if (!Number.isFinite(adaptationId)) throw new Error(`Invalid adaptation id ${adaptationId} (parcel ${parcel.id})`);

    // load sequence adaptation from the DB (as string)
    // todo: use one query to get adaptation via foreign key on parcel
    const adaptationResult = await this.dbClient.query(adaptationQuery(), [adaptationId]);
    if (!adaptationResult.rowCount || !adaptationResult.rows[0])
      throw new Error(`Could not find sequence adaptation with id ${adaptationId} (parcel ${parcel.id})`);
    const adaptationRow = adaptationResult.rows[0];
    const adaptationCode = (adaptationRow.adaptation || '') as string;
    if (!adaptationCode.length)
      throw new Error(`Could not find sequence adaptation with id ${adaptationId} (parcel ${parcel.id})`);

    // the adaptation code is expected to be a commonjs module which calls `require(...)`
    // to load its Codemirror dependencies. It *must* use the same Codemirror instance/globals as the
    // outer page context, rather than bundling its own, due to the way CM uses shared internal state fields.
    // To ensure this, pass a custom `require` function to the module which injects the page's CM dependencies.
    // (any other dependencies are expected to be bundled into the adaptation code)
    const moduleRequire = (id: string) => {
      return {
        '@codemirror/language': cmLanguage,
        '@codemirror/state': cmState,
        // stubs only, these depend on the browser DOM api but may be required by adaptation anyway
        '@codemirror/commands': {},
        '@codemirror/view': {
          // existing adaptations call Decoration.mark in top-level code, throws if it doesn't exist
          // todo: refactor adaptation to not call this until needed
          Decoration: { mark: () => ({}) },
        },
      }[id];
    };
    // adaptation code will set `exports.adaptation = adaptation;`
    const moduleExports = {} as any; // todo better typing
    // evaluate the adaptation code in a node VM context & return the result
    // pass our console down in context to make sure console.logs from inside adaptation code get logged
    const vmContext = vm.createContext({
      console,
      require: moduleRequire,
      exports: moduleExports,
      // include a few more built-ins to be safe
      module: { exports: moduleExports },
      globalThis: {},
      setTimeout,
      clearTimeout,
    });
    let adaptation: any;
    try {
      vm.runInContext(adaptationCode, vmContext, { displayErrors: true });
      adaptation = moduleExports.adaptation; // running adaptation code will mutate exports
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      throw new Error(`failed to execute adaptation ${adaptationId} (parcel ${parcel.id}): ${message}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (typeof adaptation !== 'object' || adaptation === null) {
      throw new TypeError(
        `Adaptation ${adaptationId} did not export an object, ensure that your adaptation sets \`exports.adaptation\`: ${String(adaptation)}`,
      );
    }
    return adaptation;
  }
}

/*
** Deprecated until we figure out how/if we should get a hasura auth token
** (currently we only have a PG DB connection in the action context)

export async function postToAerie(aerieInstanceUrl: string, endpoint: string, authToken: string): Promise<any> {
  const response = await fetch(`${aerieInstanceUrl}/${endpoint}`, {
    method: 'post',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  return await response.json();
}

export async function getFromAerie(aerieInstanceUrl: string, endpoint: string, authToken: string): Promise<any> {
  const response = await fetch(`${aerieInstanceUrl}/${endpoint}`, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  return await response.json();
}
*/
