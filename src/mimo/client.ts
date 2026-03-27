import { Account } from '../accounts.js';
import { v4 as uuidv4 } from 'uuid';

export interface MimoUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

export interface MimoChunk {
  type: 'text' | 'usage' | 'dialogId' | 'finish' | 'error';
  content?: string;
  usage?: MimoUsage;
}

export interface MimoChatOptions {
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
  webSearchMode?: 'disabled' | 'auto' | 'enabled';
  enableThinking?: boolean;
  model?: string;
}

export interface MimoError {
  status: number;
  type: 'auth' | 'banned_temporary' | 'banned_permanent' | 'rate_limit' | 'server_error' | 'bad_request' | 'unknown';
  message: string;
  detail?: string;
}

const API_URL = 'https://aistudio.xiaomimimo.com/open-apis/bot/chat';

export function parseMimoError(status: number, detail?: string): MimoError {
  switch (status) {
    case 400:
      return { status, type: 'bad_request', message: 'MiMo 请求参数错误', detail };
    case 401:
    case 403:
      return { status, type: 'auth', message: '登录已过期，请重新登录', detail };
    case 451:
      return { status, type: 'banned_temporary', message: '账号已被临时封禁', detail };
    case 461:
      return { status, type: 'banned_permanent', message: '账号已被永久封禁', detail };
    case 429:
      return { status, type: 'rate_limit', message: '请求过于频繁，请稍后重试', detail };
    case 503:
      return { status, type: 'server_error', message: '服务暂时不可用，请稍后重试', detail };
    default:
      return { status, type: 'unknown', message: `MiMo API 错误: ${status}`, detail };
  }
}

export async function* callMimo(
  account: Account,
  conversationId: string,
  query: string,
  options: MimoChatOptions = {}
): AsyncGenerator<MimoChunk> {
  const {
    temperature = 0.8,
    topP = 0.95,
    systemPrompt = '',
    webSearchMode = 'disabled',
    enableThinking = false,
    model = 'mimo-v2-pro'
  } = options;

  const body = {
    msgId: uuidv4().replace(/-/g, '').slice(0, 32),
    conversationId,
    content: query,
    model,
    temperature,
    topP,
    systemPrompt,
    webSearchMode,
    enableThinking,
    multiMedias: [],
  };

  const url = `${API_URL}?xiaomichatbot_ph=${encodeURIComponent(account.ph_token)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': 'zh-CN',
      'Cookie': `serviceToken=${account.service_token}; userId=${account.user_id}; xiaomichatbot_ph=${account.ph_token}`,
      'Origin': 'https://aistudio.xiaomimimo.com',
      'Referer': 'https://aistudio.xiaomimimo.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-timezone': 'Asia/Shanghai',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const error = parseMimoError(resp.status, detail);
    yield { type: 'error', content: JSON.stringify(error) };
    return;
  }
  if (!resp.body) throw new Error('No response body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('event:')) {
        event = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        try {
          const data = JSON.parse(trimmed.slice(5).trim());
          if (event === 'message') {
            yield { type: 'text', content: data.content ?? '' };
          } else if (event === 'usage') {
            yield {
              type: 'usage',
              usage: {
                promptTokens: data.promptTokens ?? 0,
                completionTokens: data.completionTokens ?? 0,
                totalTokens: data.totalTokens ?? 0,
                reasoningTokens: data.nativeUsage?.completion_tokens_details?.reasoning_tokens ?? 0,
              },
            };
          } else if (event === 'finish') {
            yield { type: 'finish' };
          } else if (event === 'dialogId') {
            yield { type: 'dialogId', content: data.content };
          }
        } catch {
          // skip malformed SSE data
        }
      }
    }
  }
}
