import { ChatMessage } from '../types';
import { supabase } from '@/integrations/supabase/client';

async function callProxy(action: string, payload: object): Promise<string> {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action, payload }
  });

  if (error) throw new Error(error.message || 'Backend function error');
  if (data?.error) throw new Error(data.error);
  if (!data?.text) throw new Error('API 回傳空白結果，請稍後重試');
  return data.text;
}

export class GeminiService {
  async correctTranscript(transcript: string, metadata: any): Promise<string> {
    if (!transcript?.trim()) throw new Error('逐字稿內容不得為空');
    return callProxy('correctTranscript', { transcript, metadata });
  }

  async analyzeTranscript(
    transcript: string,
    moduleId: string,
    moduleName: string,
    history: ChatMessage[] = []
  ): Promise<string> {
    if (!transcript?.trim()) throw new Error('逐字稿內容不得為空');
    return callProxy('analyzeTranscript', { transcript, moduleId, moduleName, history });
  }
}

export const geminiService = new GeminiService();
