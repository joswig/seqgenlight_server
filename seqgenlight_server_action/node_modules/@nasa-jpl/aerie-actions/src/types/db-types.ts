export type ReadDictionaryResult = {
  id: number;
  dictionary_path: string;
  dictionary_file_path: string;
  mission: string;
  version: string;
  parsed_json: any;
  created_at: Date;
  updated_at: Date;
};

export type ReadParcelResult = {
  id: number;
  name: string;
  command_dictionary_id: number;
  channel_dictionary_id: number;
  parameter_dictionary_ids: number[];
  sequence_adaptation_id: number;
  created_at: Date;
  owner?: string;
  updated_at: Date;
  updated_by: string;
};

export type FileMetadata = {
  createdAt?: string;
  createdBy?: string;
  lastEditedAt?: string;
  lastEditedBy?: string;
  readOnly?: boolean;
  user?: Record<string, unknown>;
  version?: string;
};

export type FileMetadataWritable = Pick<FileMetadata, 'readOnly' | 'user'>;

export type FileMetadataWriteResult = {
  success: true;
  response: string;
};
