#!/usr/bin/env python3
"""
SeqGenLight Server - A lightweight web service wrapper for F Prime's seqgen.py
"""

import os
import sys
import tempfile
import json
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from werkzeug.exceptions import BadRequest

# Add the parent directory to the path to import seqgen
parent_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(parent_dir))

try:
    from seqgen import generateSequence, SeqGenException
except ImportError:
    print("Warning: Could not import seqgen module. Make sure seqgen.py is in the path.")
    generateSequence = None
    SeqGenException = Exception

app = Flask(__name__)

# Configuration
HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', 5000))


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'seqgenlight'
    })


@app.route('/compile', methods=['POST'])
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
    try:
        # Validate request
        if not request.is_json:
            raise BadRequest("Request must be JSON")

        data = request.get_json()

        # Validate required fields
        if 'sequence' not in data:
            raise BadRequest("Missing required field: sequence")
        if 'command_dictionary' not in data:
            raise BadRequest("Missing required field: command_dictionary")

        sequence_content = data['sequence']
        dict_content = data['command_dictionary']
        timebase_str = data.get('timebase', '0xFFFF')

        # Parse timebase
        try:
            if timebase_str.startswith('0x') or timebase_str.startswith('0X'):
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

            # Write command dictionary
            dict_file = tmpdir_path / "command_dict.json"
            dict_file.write_text(dict_content)

            # Output file
            output_file = tmpdir_path / "output.bin"

            # Run seqgen
            try:
                generateSequence(
                    str(seq_file),
                    str(output_file),
                    str(dict_file),
                    timebase
                )

                # Read the output file
                output_data = output_file.read_bytes()

                return jsonify({
                    'status': 'success',
                    'message': 'Compilation successful',
                    'outputFile': 'output.bin',
                    'size': len(output_data)
                })

            except SeqGenException as e:
                return jsonify({
                    'status': 'error',
                    'message': str(e),
                    'errors': [str(e)]
                }), 400
            except Exception as e:
                return jsonify({
                    'status': 'error',
                    'message': f'Compilation failed: {str(e)}',
                    'errors': [str(e)]
                }), 500

    except BadRequest as e:
        return jsonify({
            'status': 'error',
            'message': str(e),
            'errors': [str(e)]
        }), 400
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Internal server error: {str(e)}',
            'errors': [str(e)]
        }), 500


@app.route('/', methods=['GET'])
def index():
    """Root endpoint with API documentation"""
    return jsonify({
        'service': 'SeqGenLight Server',
        'version': '1.0.0',
        'endpoints': {
            '/health': 'GET - Health check',
            '/compile': 'POST - Compile sequence with seqgen.py',
            '/': 'GET - This documentation'
        }
    })


if __name__ == '__main__':
    print(f"Starting SeqGenLight Server on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=True)
