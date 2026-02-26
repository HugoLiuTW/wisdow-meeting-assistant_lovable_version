import { ChatMessage } from '../types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGemini(systemInstruction: string, userPrompt: string, apiKey: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.3 }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || '呼叫 Gemini API 發生錯誤');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGeminiWithHistory(
  systemInstruction: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  apiKey: string
): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.5 }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || '呼叫 Gemini API 發生錯誤');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export class GeminiService {
  async correctTranscript(transcript: string, metadata: any, apiKey: string): Promise<string> {
    const systemInstruction = '你是一位專業的錄音逐字稿校正員。請根據校正規則進行處理。';
    const prompt = `
現在請執行「逐字稿校正」任務。

【會議背景資訊】
主題：${metadata.subject}
關鍵字：${metadata.keywords}
說話者：${metadata.speakers}
術語：${metadata.terminology}
長度：${metadata.length}

【原始逐字稿內容】
${transcript}
    `;
    return callGemini(systemInstruction, prompt, apiKey);
  }

  async analyzeTranscript(
    transcript: string,
    modulePrompt: string,
    history: ChatMessage[] = [],
    apiKey: string
  ): Promise<string> {
    const systemInstruction = '你是一位專業的會議洞察分析師。請根據模組任務深度分析逐字稿，以繁體中文回答，使用 Markdown 格式輸出。';

    if (history.length === 0) {
      const prompt = `
以下是已校正的會議逐字稿：
---
${transcript}
---

【模組任務目標】
${modulePrompt}

請根據以上逐字稿，執行任務目標，以繁體中文輸出。
      `;
      return callGemini(systemInstruction, prompt, apiKey);
    }

    // Build conversation history
    const contents = history.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    }));

    // First message context
    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({
        role: 'user',
        parts: [{ text: `以下是已校正的會議逐字稿：\n---\n${transcript}\n---\n\n【模組任務目標】\n${modulePrompt}\n\n請根據以上逐字稿，執行任務目標，以繁體中文輸出。` }]
      });
    }

    return callGeminiWithHistory(systemInstruction, contents, apiKey);
  }
}

export const geminiService = new GeminiService();
