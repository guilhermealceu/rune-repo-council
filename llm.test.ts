import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerLLM } from './llm';

test('Groq padrão, validação, erros e Ollama somente por seleção explícita', async () => {
  const priorKey = process.env.GROQ_API_KEY;
  const calls: { url: string; body: any; headers: any }[] = [];
  let reply = { choices: [{ message: { content: 'APROVADO' }, finish_reason: 'stop' }] };
  const app = express();
  app.use(express.json());
  registerLLM(app, (async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options!.body as string), headers: options!.headers });
    return new Response(JSON.stringify(String(url).includes('/api/chat') ? { message: { content: 'Simples' } } : reply), { status: 200 });
  }) as typeof fetch);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}`;
  const post = (body: any) => fetch(`${endpoint}/api/llm/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Revise este código.' }] };
  try {
    delete process.env.GROQ_API_KEY;
    assert.equal((await post(body)).status, 503);
    assert.equal(calls.length, 0);
    process.env.GROQ_API_KEY = 'test-secret';
    const status = await (await fetch(`${endpoint}/api/llm/status`)).json();
    assert.equal(status.configured, true);
    assert.equal(JSON.stringify(status).includes('test-secret'), false);
    assert.equal((await post({ ...body, model: 'paid-model' })).status, 400);
    assert.equal((await post({ ...body, messages: [{ role: 'user', content: 'x'.repeat(25000) }] })).status, 413);
    const result = await (await post(body)).json();
    assert.equal(result.content, 'APROVADO');
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-secret');
    reply = { choices: [{ message: { content: 'incompleto' }, finish_reason: 'length' }] };
    assert.equal((await post({ ...body, model: 'openai/gpt-oss-20b' })).status, 422);
    const local = await (await post({ ...body, simpleTask: true })).json();
    assert.equal(local.provider, 'ollama');
    assert.equal(calls[2].headers.Authorization, undefined);
    assert.equal(calls.length, 3);
  } finally {
    if (priorKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = priorKey;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
