export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  createdAt: number;
  rawTranscript: string;
  metadata: MeetingMetadata;
  correctedTranscript?: string;
  correctionLog?: string;
  insights: Record<string, string>;
  insightsHistory: Record<string, ChatMessage[]>;
}

export interface MeetingMetadata {
  subject: string;
  keywords: string;
  speakers: string;
  terminology: string;
  length: string;
}

export enum AnalysisModule {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  E = 'E'
}
