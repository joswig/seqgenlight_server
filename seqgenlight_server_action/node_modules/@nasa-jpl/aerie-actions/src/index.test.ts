import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { ActionsAPI } from './index';
import type { ActionsConfig } from './types';

type MockQuery = ReturnType<typeof vi.fn>;

function makeConfig(overrides: Partial<ActionsConfig> = {}): ActionsConfig {
  return {
    ACTION_FILE_STORE: '/action-store',
    SEQUENCING_FILE_STORE: '/seq-store',
    WORKSPACE_BASE_URL: 'http://workspace.local',
    SECRETS: { authorization: 'Bearer test-token' },
    USER_ROLE: 'aerie_admin',
    ...overrides,
  };
}

function makeApi(overrides: Partial<ActionsConfig> = {}, workspaceId = 42) {
  const query: MockQuery = vi.fn();
  const dbClient = { query } as unknown as PoolClient;
  const api = new ActionsAPI(dbClient, workspaceId, makeConfig(overrides));
  return { api, query };
}

function mockFetchResponse({
  ok = true,
  status = 200,
  body = 'ok',
}: { ok?: boolean; status?: number; body?: string } = {}) {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  };
}

describe('getEnvironmentVariable', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns value when name starts with PUBLIC_ACTION_', () => {
    vi.stubEnv('PUBLIC_ACTION_FOO', 'hello');
    const { api } = makeApi();
    expect(api.getEnvironmentVariable('PUBLIC_ACTION_FOO')).toBe('hello');
  });

  test('returns undefined and warns when name lacks the prefix', () => {
    vi.stubEnv('SECRET_TOKEN', 'nope');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api } = makeApi();
    expect(api.getEnvironmentVariable('SECRET_TOKEN')).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('returns undefined when a prefixed variable is unset', () => {
    const { api } = makeApi();
    expect(api.getEnvironmentVariable('PUBLIC_ACTION_MISSING')).toBeUndefined();
  });
});

describe('reqWorkspace (via listFiles)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ body: '["a.txt"]' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('throws when WORKSPACE_BASE_URL is empty', async () => {
    const { api } = makeApi({ WORKSPACE_BASE_URL: '' });
    await expect(api.listFiles('foo')).rejects.toThrow('WORKSPACE_BASE_URL not configured');
  });

  test('throws when SECRETS.authorization is missing', async () => {
    const { api } = makeApi({ SECRETS: {} });
    await expect(api.listFiles('foo')).rejects.toThrow(/Missing user authorization token/);
  });

  test('sends authorization and x-hasura-role headers when both are configured', async () => {
    const { api } = makeApi();
    await api.listFiles('foo');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.authorization).toBe('Bearer test-token');
    expect(options.headers['x-hasura-role']).toBe('aerie_admin');
  });

  test('throws `${status} - ${body}` on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ ok: false, status: 418, body: 'teapot' }));
    const { api } = makeApi();
    await expect(api.listFiles('foo')).rejects.toThrow('418 - teapot');
  });

  test('does not set Content-Type when body is FormData (fetch sets the boundary)', async () => {
    const { api } = makeApi();
    await api.writeFile('hello.txt', 'contents', true);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.headers['Content-Type']).toBeUndefined();
  });
});

describe('file operations', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ body: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('listFiles GETs /ws/:id/<encoded path>', async () => {
    const { api } = makeApi();
    await api.listFiles('sub/dir');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/sub%2Fdir');
    expect(options.method).toBe('GET');
  });

  test('readFile GETs the file path and returns its text body', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ body: 'file-contents' }));
    const { api } = makeApi();
    const result = await api.readFile('a.txt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/a.txt');
    expect(options.method).toBe('GET');
    expect(result).toBe('file-contents');
  });

  test('readFile returns empty string without throwing (empty content is valid)', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ body: '' }));
    const { api } = makeApi();
    await expect(api.readFile('empty.txt')).resolves.toBe('');
  });

  test('writeFile PUTs FormData, uses basename for filename, encodes path, and passes overwrite flag', async () => {
    const { api } = makeApi();
    await api.writeFile('foo/bar/baz.txt', 'hello', true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/foo%2Fbar%2Fbaz.txt?type=file&overwrite=true');
    expect(options.method).toBe('PUT');
    expect(options.body).toBeInstanceOf(FormData);
    const filePart = (options.body as FormData).get('file') as File;
    expect(filePart).toBeDefined();
    expect(filePart.name).toBe('baz.txt');
    expect(await filePart.text()).toBe('hello');
  });

  test('writeFile defaults overwrite to false', async () => {
    const { api } = makeApi();
    await api.writeFile('baz.txt', 'hello');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('overwrite=false');
  });

  test('copyFile POSTs { copyTo: dest } to the source path', async () => {
    const { api } = makeApi();
    await api.copyFile('src.txt', 'dest.txt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/src.txt');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ copyTo: 'dest.txt' });
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  test('moveFile POSTs { moveTo: dest } to the source path', async () => {
    const { api } = makeApi();
    await api.moveFile('src.txt', 'dest.txt');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ moveTo: 'dest.txt' });
  });

  test('deleteFile sends a DELETE and carries no request body', async () => {
    const { api } = makeApi();
    await api.deleteFile('gone.txt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/gone.txt');
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
  });

  test('createDirectory PUTs to a URL that has ?type=directory', async () => {
    const { api } = makeApi();
    await api.createDirectory('new/dir');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/new%2Fdir?type=directory');
    expect(options.method).toBe('PUT');
  });

  test('listFiles appends ?withMetadata=true when the option is set', async () => {
    const { api } = makeApi();
    await api.listFiles('sub/dir', { withMetadata: true });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/sub%2Fdir?withMetadata=true');
  });

  test('listFiles omits ?withMetadata when the option is false or absent', async () => {
    const { api } = makeApi();
    await api.listFiles('sub/dir', { withMetadata: false });
    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('withMetadata');
  });
});

describe('file metadata operations', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ body: '{}' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('getFileMetadata GETs /metadata/:id/<encoded path> and parses the JSON response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ body: '{"readonly":true,"user":{"tag":"approved"}}' }),
    );
    const { api } = makeApi();
    const result = await api.getFileMetadata('sub/dir/a.txt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/metadata/42/sub%2Fdir%2Fa.txt');
    expect(options.method).toBe('GET');
    expect(result).toEqual({ readonly: true, user: { tag: 'approved' } });
  });

  test('setFileMetadata POSTs the metadata as JSON and returns { success, response }', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ body: 'stored' }));
    const { api } = makeApi();
    const metadata = { readonly: true, user: { owner: 'me' } };
    const result = await api.setFileMetadata('a.txt', metadata);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/metadata/42/a.txt');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(metadata);
    expect(result).toEqual({ success: true, response: 'stored' });
  });

  test.each(['deep', 'shallow', 'overwrite'] as const)(
    'setFileMetadata appends ?mergeBehavior=%s when configured',
    async (mergeBehavior) => {
      const { api } = makeApi();
      await api.setFileMetadata('a.txt', { x: 1 }, { mergeBehavior });
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`http://workspace.local/metadata/42/a.txt?mergeBehavior=${mergeBehavior}`);
    },
  );

  test('setFileMetadata omits the mergeBehavior query param when no option is given', async () => {
    const { api } = makeApi();
    await api.setFileMetadata('a.txt', { x: 1 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('mergeBehavior');
  });

  test('unsetFileMetadata POSTs keys to /metadata/unset/:id/<encoded path>', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ body: 'removed' }));
    const { api } = makeApi();
    const result = await api.unsetFileMetadata('sub/a.txt', ['readonly', 'user.tag']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/metadata/unset/42/sub%2Fa.txt');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(['readonly', 'user.tag']);
    expect(result).toEqual({ success: true, response: 'removed' });
  });

  test('deleteFileMetadata DELETEs /metadata/:id/<encoded path> and returns { success, response }', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ body: 'gone' }));
    const { api } = makeApi();
    const result = await api.deleteFileMetadata('sub/a.txt');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/metadata/42/sub%2Fa.txt');
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
    expect(result).toEqual({ success: true, response: 'gone' });
  });
});

describe('dictionary reads', () => {
  const dictionaryRow = {
    id: 1,
    dictionary_path: '/a',
    dictionary_file_path: '/a/file',
    mission: 'm',
    version: '1',
    parsed_json: {},
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
  };

  const cases = [
    ['readChannelDictionary', 'channel_dictionary', /Channel Dictionary/],
    ['readCommandDictionary', 'command_dictionary', /Command Dictionary/],
    ['readParameterDictionary', 'parameter_dictionary', /Parameter Dictionary/],
  ] as const;

  test.each(cases)('%s queries sequencing.%s and returns the first row', async (method, table) => {
    const { api, query } = makeApi();
    query.mockResolvedValueOnce({ rows: [dictionaryRow], rowCount: 1 });
    const result = await (api as any)[method](1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`sequencing.${table}`);
    expect(params).toEqual([1]);
    expect(result).toEqual(dictionaryRow);
  });

  test.each(cases)('%s throws when no row exists for the given id', async (method, _table, errorPattern) => {
    const { api, query } = makeApi();
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect((api as any)[method](99)).rejects.toThrow(errorPattern);
  });
});

describe('readParcel', () => {
  const parcelRow = {
    id: 5,
    name: 'p',
    command_dictionary_id: 1,
    channel_dictionary_id: 2,
    parameter_dictionary_ids: [3],
    sequence_adaptation_id: 7,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    updated_by: 'u',
  };

  test('returns the first row from the parcel query', async () => {
    const { api, query } = makeApi();
    query.mockResolvedValueOnce({ rows: [parcelRow], rowCount: 1 });
    await expect(api.readParcel()).resolves.toEqual(parcelRow);
  });

  test('throws when no parcel is found for the workspace', async () => {
    const { api, query } = makeApi();
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(api.readParcel()).rejects.toThrow(/Could not find parcel for workspace id 42/);
  });
});

describe('loadAdaptation', () => {
  const parcelRow = {
    id: 5,
    name: 'p',
    command_dictionary_id: 1,
    channel_dictionary_id: 2,
    parameter_dictionary_ids: [],
    sequence_adaptation_id: 99,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    updated_by: 'u',
  };

  function stubAdaptationQueries(query: MockQuery, adaptationCode: string) {
    query.mockResolvedValueOnce({ rows: [parcelRow], rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [{ adaptation: adaptationCode }], rowCount: 1 });
  }

  test('evaluates the adaptation code in a VM context and returns its exports', async () => {
    const { api, query } = makeApi();
    stubAdaptationQueries(query, 'exports.adaptation = { greet: () => "hi" };');
    const adaptation = await api.loadAdaptation();
    expect(typeof adaptation.greet).toBe('function');
    expect(adaptation.greet()).toBe('hi');
  });

  test('wraps runtime errors thrown by adaptation code', async () => {
    const { api, query } = makeApi();
    stubAdaptationQueries(query, 'throw new Error("boom");');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(api.loadAdaptation()).rejects.toThrow(/failed to execute adaptation 99/);
    consoleError.mockRestore();
  });

  test('throws TypeError when adaptation does not export an object', async () => {
    const { api, query } = makeApi();
    stubAdaptationQueries(query, '// forgot to set exports.adaptation');
    await expect(api.loadAdaptation()).rejects.toThrow(TypeError);
  });
});
