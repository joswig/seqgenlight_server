import type { ActionsAPI } from '../index';

// parameter/setting schema types
export * from './schema';

export type ActionResult = {
  status: 'FAILED' | 'SUCCESS';
  data: any;
  [key: string]: any;
};

export type ActionMain = (
  // Parameters and settings are user-defined
  actionParameters: { [key: string]: any },
  actionSettings: { [key: string]: any },
  actionsAPI: ActionsAPI,
) => Promise<ActionResult>;

export type UserRole = string | 'aerie_admin';

export type ActionsConfig = {
  ACTION_RUN_ID?: string;
  ACTION_FILE_STORE: string;
  SEQUENCING_FILE_STORE: string;
  WORKSPACE_BASE_URL: string;
  SECRETS?: Record<string, string>;
  USER_ROLE?: string;
  USERNAME?: string;
};
