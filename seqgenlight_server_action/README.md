# seqdev-seqgenlight-action

This action compiles F Prime sequence files using seqgen.py, generating binary sequence files compatible with the F Prime sequence file loader and runner.

## Overview

This action takes a sequence from Aerie and uses the F Prime seqgen.py compiler to generate a binary sequence file (.bin). The action communicates with a web service that wraps seqgen.py functionality.

## Prerequisites

- Node.js (version 22.x recommended, 18.x+ required)
- A web service that wraps seqgen.py (see below)
- F Prime command dictionary uploaded to Aerie

## Usage

1. Install dependencies for the `seqgen-action` with:
   ```bash
   npm install
   ```

2. Build the action by running:
   ```bash
   npm run build
   ```
   This generates a bundled file at `dist/action.js`, which you can [upload to SeqDev](https://nasa-ammos.github.io/plandev-docs/sequencing/actions/).

3. Configure the action settings in Aerie:
   - `seqgenUrl`: URL of the seqgen web service endpoint

4. Required action parameters:
   - `sequenceName`: Name of the sequence to compile
   - `timebase` (optional): Timebase value for the sequence (defaults to 0xFFFF)

## SeqGen Web Service

This action requires a web service that accepts POST requests with the following JSON body:

```json
{
  "sequence": "...",
  "command_dictionary": "...",
  "timebase": "0xFFFF"
}
```

And returns:

```json
{
  "status": "success",
  "outputFile": "path/to/output.bin",
  "message": "Compilation successful"
}
```

Or on error:

```json
{
  "status": "error",
  "message": "Error description",
  "errors": ["Error 1", "Error 2"]
}
```

The web service should internally call seqgen.py with appropriate parameters.

## Development

To modify the action:

1. Edit the source files in `src/`
2. Rebuild with `npm run build`
3. Re-upload `dist/action.js` to Aerie

## About seqgen.py

seqgen.py is a sequence generator for F Prime that takes a .seq file as input and produces a binary sequence file. It was originally created by Kevin Dinkel at JPL.

For more information about F Prime, see the [F Prime documentation](https://nasa.github.io/fprime/).
