# main.py
from fastapi import FastAPI
from pydantic import BaseModel
import os
import requests
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

app = FastAPI()

# Permite que o frontend React acesse a API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modelo para receber o prompt do frontend
class Prompt(BaseModel):
    prompt: str

# Rota Gemini
@app.post("/api/gemini")
def call_gemini(data: Prompt):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return {"error": "GEMINI_API_KEY ausente"}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key={key}"
    body = {
        "contents": [{"role": "user", "parts": [{"text": data.prompt}]}]
    }

    try:
        r = requests.post(url, json=body)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        return {"error": str(e)}

# Rota OpenAI
@app.post("/api/openai")
def call_openai(data: Prompt):
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return {"error": "OPENAI_API_KEY ausente"}

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    body = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": data.prompt}],
        "temperature": 0.4,
        "max_tokens": 900
    }

    try:
        r = requests.post(url, json=body, headers=headers)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        return {"error": str(e)}
