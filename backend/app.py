from flask import Flask, request, jsonify
import os
import requests
from dotenv import load_dotenv

# Carrega variáveis do .env
load_dotenv()

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY")

app = Flask(__name__)

# Rota para Gemini
@app.route("/api/gemini", methods=["POST"])
def gemini():
    data = request.json
    prompt = data.get("prompt", "")
    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key={GEMINI_KEY}",
            json={"contents": [{"role": "user", "parts": [{"text": prompt}]}]},
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Rota para OpenAI
@app.route("/api/openai", methods=["POST"])
def openai():
    data = request.json
    prompt = data.get("prompt", "")
    try:
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "max_tokens": 900,
            },
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
