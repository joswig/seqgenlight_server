#!/usr/bin/env python3
"""
SeqGenLight Server - A lightweight web service wrapper for F Prime's seqgen.py
"""

import os
import sys
import tempfile
import json
import subprocess
import base64
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Configuration
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 5000))
SEQGEN_PATH = os.environ.get("SEQGEN_PATH", "seqgen.py")


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "service": "seqgenlight"})


@app.route("/compile", methods=["GET", "POST"])
def compile_sequence():
    """
    Compile a sequence using seqgen.py

    Expected JSON body:
    {
        "sequence": "<sequence content>",
        "command_dictionary": "<command dictionary content>",
        "timebase": "0xFFFF" (optional)
    }
    """
    print("hmm", file=sys.stderr)
    try:
        # Validate request
        if not request.is_json:
            raise BadRequest("Request must be JSON")

        data = request.get_json()

        # Validate required fields
        if "sequence" not in data:
            raise BadRequest("Missing required field: sequence")
        if "command_dictionary" not in data:
            raise BadRequest("Missing required field: command_dictionary")

        sequence_content = data["sequence"]
        dict_content = data["command_dictionary"]
        timebase_str = data.get("timebase", "0xFFFF")

        # Parse timebase
        try:
            if timebase_str.startswith(("0x", "0X")):
                timebase = int(timebase_str, 16)
            else:
                timebase = int(timebase_str, 0)
        except ValueError:
            raise BadRequest(f"Invalid timebase value: {timebase_str}")

        # Create temporary files
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Write sequence file
            seq_file = tmpdir_path / "input.seq"
            seq_file.write_text(sequence_content)

            with open(
                # "/Users/joswig/Workspaces/joswig_pub/seqdev_action_fprime_compiler/examples/seqgen-action/seqgenlight_server/MathDeploymentTopologyDictionary.json"
                "MathDeploymentTopologyDictionary.json"
            ) as r:
                dict_content = r.read()

            # Write command dictionary
            dict_file = tmpdir_path / "command_dict.json"
            dict_file.write_text(dict_content)

            # Output file
            output_file = tmpdir_path / "output.bin"

            # Run seqgen as a subprocess
            try:
                # Build command: seqgen.py [-h] [-d DEPLOYMENT] [--dictionary DICTIONARY] [--packet-spec PACKET_SPEC] [--packet-set-name PACKET_SET_NAME] [-t TIMEBASE] sequence [output]
                cmd = [
                    sys.executable,
                    SEQGEN_PATH,
                    str(seq_file),
                    str(output_file),
                    *(["--dictionary", str(dict_file)] if str(dict_file) else []),
                    *(["-t", str(timebase)] if str(timebase) else []),
                ]

                print(f"Running command: {' '.join(cmd)}", file=sys.stderr)

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

                if result.returncode != 0:
                    error_msg = result.stderr or result.stdout or "Unknown error"
                    print(
                        f"ERROR: SeqGen compilation failed (exit code {result.returncode}): {error_msg}",
                        file=sys.stderr,
                    )
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": error_msg.strip(),
                                "errors": [error_msg.strip()],
                                "exit_code": result.returncode,
                            }
                        ),
                        400,
                    )

                # Read the output file
                if not output_file.exists():
                    error_msg = "Output file was not created"
                    print(f"ERROR: {error_msg}", file=sys.stderr)
                    return (
                        jsonify(
                            {
                                "status": "error",
                                "message": error_msg,
                                "errors": [error_msg],
                            }
                        ),
                        500,
                    )

                output_data = output_file.read_bytes()
                output_base64 = base64.b64encode(output_data).decode('utf-8')

                return jsonify(
                    {
                        "status": "success",
                        "message": "Compilation successful",
                        "outputFile": "output.bin",
                        "size": len(output_data),
                        "data": output_base64,
                    }
                )

            except subprocess.TimeoutExpired:
                error_msg = "Compilation timeout (exceeded 30 seconds)"
                print(f"ERROR: {error_msg}", file=sys.stderr)
                return (
                    jsonify(
                        {"status": "error", "message": error_msg, "errors": [error_msg]}
                    ),
                    500,
                )
            except FileNotFoundError:
                error_msg = f"seqgen.py not found at path: {SEQGEN_PATH}"
                print(f"ERROR: {error_msg}", file=sys.stderr)
                return (
                    jsonify(
                        {"status": "error", "message": error_msg, "errors": [error_msg]}
                    ),
                    500,
                )
            except Exception as e:
                error_msg = str(e)
                print(f"ERROR: Compilation failed: {error_msg}", file=sys.stderr)
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": f"Compilation failed: {error_msg}",
                            "errors": [error_msg],
                        }
                    ),
                    500,
                )

    except BadRequest as e:
        error_msg = str(e)
        print(f"ERROR: Bad request: {error_msg}", file=sys.stderr)
        return (
            jsonify({"status": "error", "message": error_msg, "errors": [error_msg]}),
            400,
        )
    except Exception as e:
        error_msg = str(e)
        print(f"ERROR: Internal server error: {error_msg}", file=sys.stderr)
        return (
            jsonify(
                {
                    "status": "error",
                    "message": f"Internal server error: {error_msg}",
                    "errors": [error_msg],
                }
            ),
            500,
        )


@app.route("/", methods=["GET"])
def index():
    """Root endpoint with API documentation"""
    return jsonify(
        {
            "service": "SeqGenLight Server",
            "version": "1.0.0",
            "endpoints": {
                "/health": "GET - Health check",
                "/compile": "POST - Compile sequence with seqgen.py",
                "/": "GET - This documentation",
            },
        }
    )


if __name__ == "__main__":
    print(f"Starting SeqGenLight Server on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=True)
