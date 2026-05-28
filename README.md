# SeqGenLight Server

A lightweight web service wrapper for F Prime's seqgen.py compiler.

## Overview

This service provides an HTTP API for compiling F Prime sequence files using seqgen.py. It accepts sequence JSON and command dictionaries via POST requests and returns compiled binary sequence files.

## Requirements

- Python 3.8+
- Flask
- fprime-gds

## Installation

```bash
pip install -r requirements.txt
```

## Usage

Start the server:

```bash
python app.py
```

The server will listen on `http://localhost:5000` by default.

## API Endpoint

### POST /compile

Compiles a sequence using seqgen.py.

**Request Body:**
```json
{
  "sequence": "...",
  "command_dictionary": "...",
  "timebase": "0xFFFF"
}
```

**Response (Success):**
```json
{
  "status": "success",
  "outputFile": "path/to/output.bin",
  "message": "Compilation successful"
}
```

**Response (Error):**
```json
{
  "status": "error",
  "message": "Error description",
  "errors": ["Error 1", "Error 2"]
}
```

## Environment Variables

- `PORT`: Server port (default: 5000)
- `HOST`: Server host (default: 0.0.0.0)
- `SEQGEN_PATH`: Path to seqgen.py (default: searches in PATH)

## License

See parent project license.
