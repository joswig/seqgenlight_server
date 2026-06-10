export const parameterDefinitions = {
    sequenceFilePath: { type: 'sequenceList' },
    timebase: { type: 'string' }
};
export const settingDefinitions = {
    seqgenUrl: { type: "string" },
};
const sequenceFilePathError = 'SeqGen cannot be invoked without providing at least one sequence.';
export async function main(parameters, settings, actionsAPI) {
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
    const seqgenResponse = await result.json();
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
    await actionsAPI.writeFile(`${sequenceFilePath}.bin`, bytes.buffer, true);
    return {
        status: "SUCCESS",
        data: seqgenResponse,
    };
}
