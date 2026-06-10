export interface SeqGenResponse {
  status: 'success' | 'error';
  message?: string;
  outputFile?: string;
  errors?: string[];
  data?: string; // Base64 encoded binary data
}
