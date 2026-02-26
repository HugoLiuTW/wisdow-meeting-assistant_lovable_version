import { ChatMessage } from '../types';
import { supabase } from '@/integrations/supabase/client';

async function callProxy(action: string, payload: object): Promise<string> {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', {
    body: { action, payload }
  });

  if (error) throw new Error(error.message || 'Backend function error');
  if (data?.error) throw new Error(data.error);
  return data?.text || '';
}

export class GeminiService {
  async correctTranscript(transcript: string, metadata: any): Promise<string> {
    return callProxy('correctTranscript', { transcript, metadata });
  }

  async analyzeTranscript(
    transcript: string,
    modulePrompt: string,
    history: ChatMessage[] = []
  ): Promise<string> {
    return callProxy('analyzeTranscript', { transcript, modulePrompt, history });
  }
}

export const geminiService = new GeminiService();
