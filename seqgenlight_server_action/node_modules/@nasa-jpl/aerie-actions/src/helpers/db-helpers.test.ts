import { describe, test, expect } from 'vitest';
import { adaptationQuery, dictionaryQuery } from './db-helpers';

describe('adaptationQuery', () => {
  test('queries sequencing.sequence_adaptation with a parameterized id', () => {
    const sql = adaptationQuery();
    expect(sql).toContain('sequencing.sequence_adaptation');
    expect(sql).toContain('$1');
  });
});

describe('dictionaryQuery', () => {
  test.each(['channel_dictionary', 'command_dictionary', 'parameter_dictionary'] as const)(
    'returns SQL targeting sequencing.%s with a parameterized id',
    (table) => {
      const sql = dictionaryQuery(table);
      expect(sql).toContain(`sequencing.${table}`);
      expect(sql).toContain('$1');
    },
  );
});
