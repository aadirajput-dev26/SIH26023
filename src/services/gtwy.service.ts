import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const GTWY_API_KEY = process.env.GTWY_API_KEY;

export const processImage = async (filePath: string) => {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(filePath));

  const response = await axios.post('https://api.gtwy.ai/image/processing/', formData, {
    headers: {
      ...formData.getHeaders(),
      'authorization': GTWY_API_KEY,
    }
  });
  return response.data;
};

export const processPDF = async (filePath: string) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const response = await axios.post('https://api.gtwy.ai/image/processing/upload', formData, {
    headers: {
      ...formData.getHeaders(),
      'authorization': GTWY_API_KEY,
    }
  });
  return response.data;
};

export const extractAllJsonObjects = (text: string): any[] => {
  if (!text) return [];
  const results: any[] = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (depth === 0) startIdx = i;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const jsonStr = text.substring(startIdx, i + 1);
          try {
            results.push(JSON.parse(jsonStr));
          } catch {}
          startIdx = -1;
        }
      }
    }
  }

  return results;
};

export const extractGtwyContent = (raw: any): string => {
  if (!raw) return '';
  if (typeof raw === 'object') {
    return raw?.response?.data?.content ?? 
           raw?.content ?? 
           raw?.data?.content ?? 
           raw?.response ?? 
           raw?.text ?? 
           JSON.stringify(raw);
  }

  const text = String(raw).trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return parsed?.response?.data?.content ?? 
             parsed?.content ?? 
             parsed?.data?.content ?? 
             parsed?.response ?? 
             parsed?.text ?? 
             text;
    } catch {}
  }

  if (text.includes('data: ')) {
    let accumulatedContent = '';
    let endContent = null;
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonPart = line.substring(6).trim();
      if (!jsonPart || jsonPart === '[DONE]') continue;
      try {
        const item = JSON.parse(jsonPart);
        if (item.event === 'end') {
          endContent = item?.response?.data?.content || item?.data?.content;
        } else if (item.event === 'message' && item.data?.content) {
          accumulatedContent += item.data.content;
        } else if (item.content && item.event !== 'reasoning') {
          accumulatedContent += item.content;
        }
      } catch {}
    }
    if (endContent) return endContent;
    if (accumulatedContent) return accumulatedContent;
  }

  return text;
};

export const callGtwyChatAgent = async (agentId: string, threadId: string, userPrompt: string, variables: any = {}) => {
  const apiKey = process.env.GTWY_API_KEY || GTWY_API_KEY;
  const response = await axios.post('https://api.gtwy.ai/api/v2/model/chat/completion', {
    user: userPrompt,
    agent_id: agentId,
    thread_id: threadId,
    response_type: "text",
    variables
  }, {
    headers: {
      'pauthkey': apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 300000
  });
  return response.data;
};

export const streamGtwyChatAgent = async (
  agentId: string,
  threadId: string,
  userPrompt: string,
  variables: any = {},
  onDelta?: (delta: string) => void
): Promise<string> => {
  const apiKey = process.env.GTWY_API_KEY || GTWY_API_KEY;
  const res = await fetch('https://api.gtwy.ai/api/v2/model/chat/completion', {
    method: 'POST',
    headers: {
      'pauthkey': apiKey || '',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user: userPrompt,
      agent_id: agentId,
      thread_id: threadId,
      response_type: "text",
      variables
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GTWY Agent error: ${res.status} ${errorText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.substring(6).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        // Only stream delta content as instructed (skip reasoning and others)
        if (parsed.event === 'delta' && parsed.content) {
          if (onDelta) onDelta(parsed.content);
          fullResponse += parsed.content;
        } else if (parsed.event === 'message' && parsed.data?.content) {
          if (onDelta) onDelta(parsed.data.content);
          fullResponse += parsed.data.content;
        }
      } catch {}
    }
  }

  return fullResponse;
};

export const getChatHistory = async (agentId: string, threadId: string) => {
  const url = `https://db.gtwy.ai/api/history/${agentId}/${threadId}/${threadId}?page=1&limit=40&user_feedback=all&error=false`;
  const response = await axios.get(url, {
    headers: {
      'pauthkey': GTWY_API_KEY || process.env.GTWY_API_KEY,
      'Accept': 'application/json, text/plain, */*',
    }
  });
  return response.data;
};
