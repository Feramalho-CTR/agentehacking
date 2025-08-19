import React, { useState, useEffect, useRef } from "react";
import "./App.css";

/**
 * ================================
 * BRUTTUS — Agente de Pentest
 * Gemini + OpenAI → Resposta única
 * ================================
 */

/* -------- Queue para evitar rate limit -------- */
class APIQueue {
  constructor(maxConcurrent = 1, delayBetweenRequests = 2500) {
    this.queue = [];
    this.running = 0;
    this.maxConcurrent = maxConcurrent;
    this.delayBetweenRequests = delayBetweenRequests;
  }
  add(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this._process();
    });
  }
  async _process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
    const { requestFn, resolve, reject } = this.queue.shift();
    this.running++;
    try {
      const result = await requestFn();
      resolve(result);
    } catch (e) {
      reject(e);
    } finally {
      this.running--;
      setTimeout(() => this._process(), this.delayBetweenRequests);
    }
  }
}
const apiQueue = new APIQueue(1, 3000);

/* -------- Utilidades -------- */
const nowISO = () => new Date().toISOString();
const hhmm = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const createMsg = (sender, text) => ({ sender, text, time: nowISO() });

const lastN = (arr, n) => arr.slice(Math.max(arr.length - n, 0));

/* -------- Fusão simples de respostas Gemini/OpenAI -------- */
function fuseOutputs(gem, gpt) {
  const parts = [gem || "", gpt || ""].filter(Boolean);

  const extractCodeBlocks = (s) => {
    const blocks = [];
    const codeFence = /```([\s\S]*?)```/g;
    let m;
    while ((m = codeFence.exec(s))) blocks.push(m[1].trim());
    const lines = s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) =>
        /^(\$|sudo |nmap|nikto|ffuf|burp|sqlmap|amass|subfinder|httpx|feroxbuster|wpscan|whatweb|dnsrecon|dig|curl|wget|dirsearch|gobuster|masscan)\b/i.test(
          l
        )
      );
    if (lines.length) blocks.push(lines.join("\n"));
    return blocks;
  };

  const toBullets = (s) =>
    s
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^(\$|sudo )/.test(l));

  const codes = new Set();
  const bullets = new Set();

  parts.forEach((p) => {
    extractCodeBlocks(p).forEach((c) => codes.add(c));
    toBullets(p).forEach((b) => {
      if (!/sou um modelo|desculp|como IA|agrade|por favor/i.test(b)) {
        bullets.add(b);
      }
    });
  });

  const codeOut = Array.from(codes).join("\n\n");
  const bulletOut = Array.from(bullets).slice(0, 8).join("\n- ");

  let final = "";
  if (bulletOut) final += `**Resumo direto:**\n- ${bulletOut}\n\n`;
  if (codeOut) final += `**Comandos:**\n\`\`\`\n${codeOut}\n\`\`\`\n`;

  if (!final.trim()) {
    final =
      (gem || gpt || "Sem conteúdo útil retornado. Tente reenviar.").slice(
        0,
        2000
      ) + (gem && gpt ? "\n\n*(Fusão empregada.)*" : "");
  }
  return final.trim();
}

/* --------- Prompts base --------- */
const SYSTEM_STYLE = `
Você é BRUTTUS, parceiro de operação de bug bounty/pentest autorizado.
Estilo: curto, direto, humano. Foque em ação. Use jargão técnico só quando necessário.
Sempre que sugerir ferramenta, entregue COMANDO pronto (com placeholders).
Peça os resultados quando for relevante. Não repita o óbvio.
Reforce boas práticas legais/éticas e limites do escopo.
`;

const buildScopeAnalysisPrompt = ({ scope, history }) => `
${SYSTEM_STYLE}

ESCOPO (resumo do usuário):
---
${scope}
---

Objetivo: analisar o escopo e montar um plano inicial de ataque RESPONSÁVEL e alinhado ao bug bounty.

Entregue APENAS:
1) "Checklist rápido" (3-6 itens) com foco nas áreas com mais ROI.
2) "Ferramentas e comandos" por etapa (enumere), usando placeholders como <alvo>, <dominio_raiz>, <arquivo>. Inclua **breve explicação do porquê** de cada comando.
3) "Cuidados" (2-4 bullets), incluindo limites e autorização.

Histórico (recente):
${history}
`;

const buildNextStepPrompt = ({ scope, userMsg, history }) => `
${SYSTEM_STYLE}

Contexto do projeto:
${scope}

Mensagem do usuário (resultado/dúvida/erro/comando):
"${userMsg}"

Histórico (recente):
${history}

Tarefa: proponha **apenas 1 ou 2 próximos passos**.
Para cada comando, entregue:
- Por quê (breve)
- Comando pronto (com placeholders)
- O que eu devo te enviar de volta (ex: output do nmap -sV ...)
Não envie vários comandos de uma vez sem explicação.
Aguarde que eu retorne o output antes de sugerir o próximo passo.
`;

/* --------- Chamadas às IAs --------- */
async function callGemini(prompt) {
  const key = process.env.REACT_APP_GEMINI_API_KEY;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callOpenAI(prompt) {
  const key = process.env.REACT_APP_OPENAI_API_KEY;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || "";
}

/* =========================================================
   COMPONENTE
========================================================= */
function App() {
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const [apiStatus, setApiStatus] = useState({
    gemini: { available: false, tested: false, error: null },
    openai: { available: false, tested: false, error: null },
  });
  const [isInit, setIsInit] = useState(true);
  const [scope, setScope] = useState("");
  const [awaitingScope, setAwaitingScope] = useState(true);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isWaiting]);

  useEffect(() => {
    (async () => {
      const [gRes, oRes] = await Promise.all([testGemini(), testOpenAI()]);
      setApiStatus({
        gemini: { ...gRes, tested: true },
        openai: { ...oRes, tested: true },
      });

      const statusMsg = `BRUTTUS online.\nGEMINI: ${
        gRes.available ? "✅" : "❌"
      }  |  OPENAI: ${
        oRes.available ? "✅" : "❌"
      }\n\nEnvie o **escopo** do programa (HackerOne).`;
      setMessages([createMsg("system", statusMsg)]);
      setIsInit(false);
    })();
  }, []);

  const runDual = async (prompt) => {
    const tasks = [];
    if (apiStatus.gemini.available)
      tasks.push(apiQueue.add(() => callGemini(prompt)));
    if (apiStatus.openai.available)
      tasks.push(apiQueue.add(() => callOpenAI(prompt)));

    if (!tasks.length) throw new Error("Nenhuma IA disponível.");

    let gem = "",
      gpt = "";
    try {
      [gem, gpt] = await Promise.allSettled(tasks).then((settled) => {
        const vals = settled.map((s) =>
          s.status === "fulfilled" ? s.value : ""
        );
        return [vals[0] || "", vals[1] || ""];
      });
    } catch {}
    return fuseOutputs(gem, gpt);
  };

  const handleSend = async () => {
    const text = userInput.trim();
    if (!text || isInit || isWaiting) return;

    setMessages((prev) => [...prev, createMsg("user", text)]);
    setUserInput("");
    setIsWaiting(true);

    try {
      let reply = "";

      if (awaitingScope) {
        setScope(text);
        setAwaitingScope(false);

        const history = lastN(
          messages.map((m) => `${m.sender}: ${m.text}`),
          6
        ).join("\n");

        const prompt = buildScopeAnalysisPrompt({ scope: text, history });
        try {
          reply = await runDual(prompt);
        } catch (e) {
          reply =
            "Não consegui analisar com as IAs agora. Comece por recon: amass/subfinder + httpx; depois fuzz (ffuf/feroxbuster) e testes manuais no Burp. Me envie o que encontrar que seguimos.";
        }
      } else {
        const history = lastN(
          [...messages, createMsg("user", text)].map(
            (m) => `${m.sender}: ${m.text}`
          ),
          8
        ).join("\n");

        const prompt = buildNextStepPrompt({
          scope,
          userMsg: text,
          history,
        });

        try {
          reply = await runDual(prompt);
        } catch (e) {
          reply =
            "Falha temporária ao gerar a recomendação. Me diga qual comando rodou e o erro/output que ajusto o próximo passo com precisão.";
        }
      }

      setMessages((prev) => [...prev, createMsg("bruttus", reply)]);
    } finally {
      setIsWaiting(false);
    }
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>BRUTTUS — Seu Agente Hacking</h1>
        {!isInit && (
          <p>
            Status: [{apiStatus.gemini.available ? "✅ GEMINI" : "❌ GEMINI"}] ·
            [{apiStatus.openai.available ? "✅ OPENAI" : "❌ OPENAI"}]
          </p>
        )}
      </header>

      <main className="app-main">
        <div className="chat-container" ref={chatRef}>
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.sender}`}>
              <div className="bubble" style={{ whiteSpace: "pre-wrap" }}>
                {m.text}
              </div>
              <div className="time">{hhmm(m.time)}</div>
            </div>
          ))}

          {isWaiting && (
            <div className="message bruttus">
              <div className="bubble typing-bubble">
                <span className="scan-dot" />
                <span className="scan-dot" />
                <span className="scan-dot" />
              </div>
            </div>
          )}
        </div>

        <div className="user-input-container">
          <input
            type="text"
            placeholder={
              isInit
                ? "Inicializando…"
                : awaitingScope
                ? "Cole o ESCOPO do programa (HackerOne) e envie."
                : "Envie outputs/erros ou peça o próximo passo…"
            }
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={isInit || isWaiting}
          />
          <button onClick={handleSend} disabled={isInit || isWaiting}>
            {isInit ? "INIT" : "EXEC"}
          </button>
        </div>
      </main>
    </div>
  );
}

export default App;

/* --------- Teste de APIs --------- */
async function testGemini() {
  const key = process.env.REACT_APP_GEMINI_API_KEY;
  if (!key) return { available: false, error: "GEMINI key ausente" };
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
        }),
      }
    );
    if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    const ok = !!j?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { available: ok, error: ok ? null : "Resposta inválida" };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

async function testOpenAI() {
  const key = process.env.REACT_APP_OPENAI_API_KEY;
  if (!key) return { available: false, error: "OPENAI key ausente" };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
      }),
    });
    if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    const ok = !!j?.choices?.[0]?.message?.content;
    return { available: ok, error: ok ? null : "Resposta inválida" };
  } catch (e) {
    return { available: false, error: e.message };
  }
}
