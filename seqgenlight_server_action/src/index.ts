import { ActionsAPI, ActionParameterDefinitions, ActionSettingDefinitions, ActionParameters, ActionSettings } from "@nasa-jpl/aerie-actions";
import { SeqGenResponse } from './models/seqgen.js';

export const parameterDefinitions = {
  sequenceFilePath: { type: 'sequenceList' },
  timebase: { type: 'string' }
} satisfies ActionParameterDefinitions;

export const settingDefinitions = {
  seqgenUrl: { type: "string" },
} satisfies ActionSettingDefinitions;

const sequenceFilePathError = 'SeqGen cannot be invoked without providing at least one sequence.';

// generate the correct typescript types from the schemas
type MyActionParameters = ActionParameters<typeof parameterDefinitions>;
type MyActionSettings = ActionSettings<typeof settingDefinitions>;

export async function main(parameters: MyActionParameters, settings: MyActionSettings, actionsAPI: ActionsAPI) {
  if (!parameters.sequenceFilePath || !Array.isArray(parameters.sequenceFilePath) || parameters.sequenceFilePath.length === 0) {
    throw new Error(sequenceFilePathError);
  }

  if (!settings.seqgenUrl || settings.seqgenUrl.trim() === '') {
    throw new Error('SeqGen URL setting is required. Please configure the "seqgenUrl" setting (e.g., "http://localhost:5000/compile")');
  }

  // Process the first sequence in the list
  const sequenceFilePath = parameters.sequenceFilePath[0];

  // Read the sequence file from the workspace
  const sequenceContent = await actionsAPI.readFile(sequenceFilePath);

  if (!sequenceContent) {
    throw new Error(`Sequence at path ${sequenceFilePath} is empty or could not be read.`);
  }

  // Get the parcel and command dictionary
  const parcel = await actionsAPI.readParcel();
  const commandDictionary = await actionsAPI.readCommandDictionary(parcel.command_dictionary_id);
  const commandDictionaryFile = await actionsAPI.readDictionaryFile(commandDictionary.dictionary_file_path);

  // Prepare the request body for seqgen
  const requestBody = {
    'sequence': sequenceContent,
    'command_dictionary': commandDictionaryFile,
    'timebase': parameters.timebase || '0xFFFF'
  };

  const result = await fetch(settings.seqgenUrl, {
    body: JSON.stringify(requestBody),
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!result.ok) {
    console.log(await result.text());
    throw new Error(`SeqGen service returned error: ${result.status} ${result.statusText}`);
  }

  const seqgenResponse = await result.json() as SeqGenResponse;

  if (seqgenResponse.status === 'error') {
    throw new Error(`SeqGen compilation failed: ${seqgenResponse.message || 'Unknown error'}`);
  }

  // Decode base64 data to binary
  if (!seqgenResponse.data) {
    throw new Error('SeqGen response missing binary data');
  }

  const base64Data = seqgenResponse.data;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Write the binary file
  await actionsAPI.writeFile(`${sequenceFilePath}.bin`, bytes.buffer as any, true);

  return {
    status: "SUCCESS",
    data: seqgenResponse,
  };
}
