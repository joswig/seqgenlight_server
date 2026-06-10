import { PoolClient, QueryResult } from 'pg';
import { ReadParcelResult } from '../types/db-types';

/**
 * DB query to get a sequence adaptation with the given ID
 */
export function adaptationQuery(): string {
  return `
    select id, adaptation, name, created_at, owner, updated_at, updated_by
    from sequencing.sequence_adaptation
      where id = $1;
  `;
}

export function dictionaryQuery(
  tableName: 'channel_dictionary' | 'command_dictionary' | 'parameter_dictionary',
): string {
  return `
    select id, dictionary_path, dictionary_file_path, mission, version, parsed_json, created_at, updated_at
    from sequencing.${tableName}
      where id = $1;
  `;
}

export function queryReadParcel(dbClient: PoolClient, workspaceId: number): Promise<QueryResult<ReadParcelResult>> {
  return dbClient.query(
    `
      select 
        p.name, 
        p.id, 
        p.command_dictionary_id, 
        p.channel_dictionary_id, 
        coalesce(
            array_agg(ppd.parameter_dictionary_id order by ppd.parameter_dictionary_id)
            filter (where ppd.parameter_dictionary_id is not null),
            '{}'
        ) as parameter_dictionary_ids,
        p.sequence_adaptation_id, 
        p.created_at, 
        p.owner, 
        p.updated_at, 
        p.updated_by
      from sequencing.parcel p
      left join sequencing.parcel_to_parameter_dictionary ppd
        on p.id = ppd.parcel_id
      where p.id = (
        select parcel_id
        from sequencing.workspace
        where id = $1
      )
      group by
        p.name,
        p.id,
        p.command_dictionary_id,
        p.channel_dictionary_id,
        p.sequence_adaptation_id,
        p.created_at,
        p.owner,
        p.updated_at,
        p.updated_by;
    `,
    [workspaceId],
  );
}
