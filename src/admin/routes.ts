import { Hono } from 'hono';
import { config } from '../config.js';
import {
  listAccounts, createAccount, getAccountById,
  updateAccount, deleteAccount, parseCurl,
  getAccountByApiKey
} from '../accounts.js';
import { listSessions, deleteSession } from '../mimo/session.js';
import { db } from '../db.js';
import { callMimo } from '../mimo/client.js';
import { v4 as uuidv4 } from 'uuid';

async function adminAuth(c: Parameters<Parameters<Hono['use']>[1]>[0], next: () => Promise<void>): Promise<void | Response> {
  const key = c.req.header('X-Admin-Key') ?? c.req.query('admin_key');
  if (key !== config.adminKey) {
    return c.json({ error: 'Forbidden' }, 403) as unknown as Response;
  }
  await next();
}

export function registerAdmin(app: Hono) {
  const admin = new Hono();
  admin.use('/*', adminAuth);

  // --- Accounts ---
  admin.get('/accounts', (c) => {
    return c.json(listAccounts());
  });

  admin.post('/accounts', async (c) => {
    const body = await c.req.json();
    let data: { service_token: string; user_id: string; ph_token: string; alias?: string } | null = null;

    if (body.curl) {
      const parsed = parseCurl(body.curl);
      if (!parsed) return c.json({ error: 'Failed to parse cURL command' }, 400);
      data = { ...parsed, alias: body.alias };
    } else if (body.service_token) {
      data = {
        service_token: body.service_token,
        user_id: body.user_id ?? '',
        ph_token: body.ph_token ?? '',
        alias: body.alias,
      };
    } else {
      return c.json({ error: 'Provide curl or service_token' }, 400);
    }

    const result = createAccount(data);
    return c.json({ ...result, message: 'Account created' }, 201);
  });

  admin.patch('/accounts/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const account = getAccountById(id);
    if (!account) return c.json({ error: 'Not found' }, 404);
    updateAccount(id, { alias: body.alias, is_active: body.is_active });
    return c.json({ message: 'Updated' });
  });

  admin.delete('/accounts/:id', (c) => {
    const id = c.req.param('id');
    const account = getAccountById(id);
    if (!account) return c.json({ error: 'Not found' }, 404);
    deleteAccount(id);
    return c.json({ message: 'Deleted' });
  });

  admin.post('/accounts/test', async (c) => {
    const body = await c.req.json();
    const account = body.api_key
      ? getAccountByApiKey(body.api_key)
      : getAccountById(body.id);
    if (!account) return c.json({ error: 'Account not found' }, 404);

    try {
      const convId = uuidv4().replace(/-/g, '');
      let reply = '';
      let error: string | null = null;
      for await (const chunk of callMimo(account, convId, 'hi', { enableThinking: false })) {
        if (chunk.type === 'text') reply += chunk.content ?? '';
        if (chunk.type === 'error') error = chunk.content ?? '未知错误';
      }
      if (error) return c.json({ success: false, error });
      return c.json({ success: true, response: reply.slice(0, 200) });
    } catch (e) {
      return c.json({ success: false, error: String(e) });
    }
  });

  // --- Sessions ---
  admin.get('/sessions', (c) => {
    return c.json(listSessions());
  });

  admin.delete('/sessions/:id', (c) => {
    deleteSession(c.req.param('id'));
    return c.json({ message: 'Deleted' });
  });

  // --- Logs ---
  admin.get('/logs', (c) => {
    const accountId = c.req.query('account_id');
    const status = c.req.query('status');
    const page = Number(c.req.query('page') ?? 1);
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM request_logs WHERE 1=1';
    const params: unknown[] = [];
    if (accountId) { sql += ' AND account_id = ?'; params.push(accountId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(sql).all(...params);
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM request_logs').get() as { cnt: number }).cnt;
    return c.json({ logs, total, page, limit });
  });

  // --- Stats ---
  admin.get('/stats', (c) => {
    const accounts = db.prepare(`
      SELECT a.id, a.alias, a.api_key, a.is_active, a.active_requests,
             COALESCE(SUM(l.prompt_tokens), 0) as total_prompt_tokens,
             COALESCE(SUM(l.completion_tokens), 0) as total_completion_tokens,
             COUNT(l.id) as total_requests
      FROM accounts a
      LEFT JOIN request_logs l ON a.id = l.account_id
      GROUP BY a.id
    `).all();
    return c.json({ accounts });
  });

  app.route('/admin', admin);
}
