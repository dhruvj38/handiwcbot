#!/usr/bin/env python3
"""
Whisper HTTP Server for Discord Bot
Provides a simple HTTP API for audio transcription using faster-whisper
"""

import os
import tempfile
from flask import Flask, request, jsonify
from faster_whisper import WhisperModel

app = Flask(__name__)

# Initialize Whisper model
# Options: tiny, base, small, medium, large-v2, large-v3
# Default to 'tiny' for fastest real-time VC behavior unless overridden
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")  # Use "cuda" for GPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")  # int8, float16, float32

print(f"Loading Whisper model: {MODEL_SIZE} on {DEVICE} with {COMPUTE_TYPE} precision...")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Whisper model loaded successfully!")


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "ok", "model": MODEL_SIZE}), 200


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe audio file
    Expects multipart/form-data with 'file' field containing audio
    Returns JSON with transcription text and optional confidence
    """
    try:
        # Check if file is present
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "Empty filename"}), 400
        
        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix='.audio') as temp_file:
            file.save(temp_file.name)
            temp_path = temp_file.name
        
        try:
            # Transcribe using faster-whisper
            # Use a small beam_size for much faster decoding on CPU.
            segments, info = model.transcribe(
                temp_path,
                beam_size=1,
                language="en",  # Auto-detect if None, or specify language
                vad_filter=True,  # Enable VAD to prevent decoder loops on silence
                vad_parameters=dict(
                    min_silence_duration_ms=300,  # Minimum silence to split on
                    speech_pad_ms=200,  # Padding around detected speech
                ),
                condition_on_previous_text=False,  # Prevent repetitive hallucinations
                no_speech_threshold=0.6,  # Higher threshold to filter low-confidence
                hallucination_silence_threshold=1.0,  # Suppress "Thank you" hallucinations
            )
            
            # Combine all segments into full transcript
            full_text = " ".join([segment.text for segment in segments]).strip()
            print(f"Transcribed {info.duration:.2f}s audio: '{full_text}' (confidence: {info.language_probability:.2f})")
            
            # Get response format from request
            response_format = request.form.get('response_format', 'json')
            
            if response_format == 'verbose_json':
                # Return detailed response with confidence
                return jsonify({
                    "text": full_text.strip(),
                    "confidence": info.language_probability,
                    "language": info.language,
                    "duration": info.duration
                }), 200
            else:
                # Return simple text response
                return jsonify({
                    "text": full_text.strip()
                }), 200
                
        finally:
            # Clean up temp file
            os.unlink(temp_path)
    
    except Exception as e:
        print(f"Transcription error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # Run server
    port = int(os.environ.get("PORT", 8000))
    print(f"\nWhisper server starting on http://localhost:{port}")
    print(f"Model: {MODEL_SIZE} | Device: {DEVICE} | Compute: {COMPUTE_TYPE}\n")
    app.run(host='0.0.0.0', port=port, debug=False)
