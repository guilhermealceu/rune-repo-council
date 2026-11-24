import type { Express } from 'express';
import { setTimeout as delay } from 'node:timers/promises';

export const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

export function registerLLM(app: Express, request: typeof fetch = fetch) {
  let queue: Promise<unknown> = Promise.resolve();
  const nextRequest = new Map<string, number>();

  app.get('/api/llm/status', (_req, res) => {
    res.json({ configured: Boolean(process.env.GROQ_API_KEY), models: GROQ_MODELS });
  });

  app.post('/api/llm/chat', async (req, res) => {
    const { model, messages, simpleTask = false, maxTokens = 1500 } = req.body;
    if (!Array.isArray(messages) || messages.length === 0 || messages.some(m =>
      !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
      return res.status(400).json({ error: 'Mensagens inválidas.' });
    }
    if (typeof simpleTask !== 'boolean') return res.status(400).json({ error: 'Tarefa simples inválida.' });
    if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 2500) return res.status(400).json({ error: 'Limite de saída inválido.' });
    if (!simpleTask && !GROQ_MODELS.includes(model)) {
      return res.status(400).json({ error: 'Escolha GPT-OSS 120B ou 20B do Groq.' });
    }
    if (!simpleTask && !process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'Configure GROQ_API_KEY em .env.local e reinicie o servidor.' });
    }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const signal = controller.signal;
    const perform = async () => {
      const estimatedTokens = Math.ceil(Buffer.byteLength(messages.map(m => m.content).join('')) / 3) + maxTokens + 100;
      if (!simpleTask && estimatedTokens > 8000) {
        return res.status(413).json({ error: 'Contexto excede o orçamento do plano gratuito Groq. Reduza os arquivos/contexto da análise.' });
      }
      if (!simpleTask) {
        await delay(Math.max(0, (nextRequest.get(model) || 0) - Date.now()), undefined, { signal });
        nextRequest.set(model, Date.now() + Math.max(2100, Math.ceil(estimatedTokens * 60000 / 8000)));
      }
      signal.throwIfAborted();
      const endpoint = simpleTask
        ? `${(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`
        : 'https://api.groq.com/openai/v1/chat/completions';
      const body = simpleTask
        ? { model: process.env.OLLAMA_MODEL || 'phi3:mini', messages, stream: false }
        : { model, messages, stream: false, max_completion_tokens: maxTokens, reasoning_effort: 'low' };
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(!simpleTask ? { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        });
        if (!simpleTask && response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await response.body?.cancel();
          await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60000, undefined, { signal });
          continue;
        }
        const data = await response.json();
        if (!response.ok) {
          return res.status(response.status).json({ error: data.error?.message || data.error || `Erro no ${simpleTask ? 'Ollama' : 'Groq'} (${response.status}).` });
        }
        const choice = data.choices?.[0];
        if (choice?.finish_reason === 'length') {
          return res.status(422).json({ error: 'Resposta incompleta: limite de saída atingido. Reduza o tamanho do arquivo/tarefa.' });
        }
        const content = simpleTask ? data.message?.content : choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('O modelo retornou uma resposta vazia.');
        return res.json({ content, model: body.model, provider: simpleTask ? 'ollama' : 'groq' });
      }
    };
    try {
      if (simpleTask) await perform();
      else {
        const pending = queue.then(perform);
        queue = pending.catch(() => {});
        await pending;
      }
    } catch (error: any) {
      if (!signal.aborted && !res.headersSent) res.status(502).json({ error: error.name === 'TimeoutError' ? 'O modelo excedeu o tempo de resposta.' : 'Falha ao consultar o modelo. Verifique a conexão e o provedor.' });
    }
  });
}
