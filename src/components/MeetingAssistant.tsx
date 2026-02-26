import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Edit3, ChevronRight, Clock,
  Upload, BrainCircuit, Settings, Menu, X, Copy, Check,
  Loader2, Sparkles, Send, LogOut,
  ChevronLeft, History, Zap, AlertCircle
} from 'lucide-react';
import { MeetingMetadata, ChatMessage } from '../types';
import { INSIGHT_MODULE_CONFIGS } from '../constants';
import { geminiService } from '../services/geminiService';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeetingRecord {
  id: string;
  title: string;
  createdAt: number;
  rawTranscript: string;
  metadata: MeetingMetadata;
}

interface TranscriptVersion {
  id: string;
  versionNumber: number;
  correctedTranscript: string;
  correctionLog?: string;
  createdAt: number;
}

interface ModuleVersion {
  id: string;
  moduleId: string;
  versionNumber: number;
  createdAt: number;
  messages: ChatMessage[];
}

// ─── Inline Markdown Parser (bold, italic, inline code) ──────────────────────
const parseInline = (text: string): React.ReactNode[] => {
  const tokens = text.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('***') && token.endsWith('***'))
      return <strong key={idx}><em>{token.slice(3, -3)}</em></strong>;
    if (token.startsWith('**') && token.endsWith('**'))
      return <strong key={idx}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2)
      return <em key={idx}>{token.slice(1, -1)}</em>;
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2)
      return <code key={idx} className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]">{token.slice(1, -1)}</code>;
    return token;
  });
};

// ─── Markdown Renderer ────────────────────────────────────────────────────────
const MarkdownRenderer = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Table ──
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|[-| :]+\|$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = (row: string) =>
        row.split('|').filter((_, ci, arr) => ci > 0 && ci < arr.length - 1).map(c => c.trim());
      const headerCells = parseRow(tableLines[0]);
      const bodyRows = tableLines.slice(2).map(parseRow);
      elements.push(
        <div key={`table-${i}`} className="table-wrapper">
          <table>
            <thead>
              <tr>{headerCells.map((cell, idx) => <th key={idx}>{parseInline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{parseInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Headings ──
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i}>{parseInline(line.substring(2))}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i}>{parseInline(line.substring(3))}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i}>{parseInline(line.substring(4))}</h3>);
    } else if (line.startsWith('#### ')) {
      elements.push(<h3 key={i}>{parseInline(line.substring(5))}</h3>);

    // ── Unordered list ──
    } else if (/^(\s*)([-*+]) /.test(line)) {
      const content = line.replace(/^\s*[-*+] /, '');
      const indent = (line.match(/^(\s+)/)?.[1].length || 0) > 0;
      elements.push(
        <ul key={i} className={indent ? 'pl-4' : ''}>
          <li>{parseInline(content)}</li>
        </ul>
      );

    // ── Ordered list ──
    } else if (/^\s*\d+\. /.test(line)) {
      const content = line.replace(/^\s*\d+\. /, '');
      elements.push(<ol key={i}><li>{parseInline(content)}</li></ol>);

    // ── Blockquote ──
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-4 border-primary/40 pl-4 my-2 text-muted-foreground italic text-sm">
          {parseInline(line.substring(2))}
        </blockquote>
      );

    // ── Horizontal rule ──
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-border my-4" />);

    // ── Blank line ──
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);

    // ── Paragraph ──
    } else {
      elements.push(<p key={i}>{parseInline(line)}</p>);
    }

    i++;
  }

  return <div className="markdown-content">{elements}</div>;
};

// ─── Version Paginator ────────────────────────────────────────────────────────
function VersionPaginator({ total, current, onChange }: { total: number; current: number; onChange: (v: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1 ios-surface rounded-xl px-2 py-1">
      <button onClick={() => onChange(current - 1)} disabled={current <= 1}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors">
        <ChevronLeft size={13} />
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => i + 1).map(v => (
          <button key={v} onClick={() => onChange(v)}
            className={`w-6 h-6 rounded-lg text-[10px] font-semibold transition-all ${v === current ? 'bg-primary text-primary-foreground shadow-ios-sm' : 'text-muted-foreground hover:text-primary'}`}>
            {v}
          </button>
        ))}
      </div>
      <button onClick={() => onChange(current + 1)} disabled={current >= total}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors">
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

// ─── Progress Steps ────────────────────────────────────────────────────────────
function ProgressSteps({ step, label }: { step: 1 | 2 | 3; label: string }) {
  const steps = [
    { n: 1, label: '[1/3] 數據上傳' },
    { n: 2, label: '[2/3] 核心解讀' },
    { n: 3, label: '[3/3] 結果渲染' },
  ];
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3">
        {steps.map((s, idx) => (
          <React.Fragment key={s.n}>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${s.n === step ? 'bg-primary/10 text-primary' : 'text-muted-foreground opacity-40'}`}>
              {s.n === step && <Loader2 size={12} className="animate-spin" />}
              {s.label}
            </div>
            {idx < 2 && <div className={`w-8 h-px transition-all ${s.n < step ? 'bg-primary' : 'bg-border'}`} />}
          </React.Fragment>
        ))}
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Error Banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-destructive/8 border border-destructive/20 text-destructive">
      <AlertCircle size={17} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold">發生錯誤</p>
        <p className="text-xs mt-1 opacity-75">{message}</p>
      </div>
      <button onClick={onDismiss} className="p-1 hover:opacity-60 transition-opacity"><X size={15} /></button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const MeetingAssistant: React.FC = () => {
  const { user, signOut } = useAuth();
  const [records, setRecords] = useState<MeetingRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<1 | 2 | 3>(1);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  // Active tab in step 3 (which module tab is selected)
  const [activeModuleTab, setActiveModuleTab] = useState<string>('A');

  const [localMetadata, setLocalMetadata] = useState<MeetingMetadata>({ subject: '', keywords: '', speakers: '', terminology: '', length: '' });
  const [localTranscript, setLocalTranscript] = useState('');

  const [transcriptVersions, setTranscriptVersions] = useState<TranscriptVersion[]>([]);
  const [activeTranscriptVersion, setActiveTranscriptVersion] = useState(1);
  const [moduleVersionsMap, setModuleVersionsMap] = useState<Record<string, ModuleVersion[]>>({});
  const [activeModuleVersion, setActiveModuleVersion] = useState<Record<string, number>>({});

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load records ──────────────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from('meeting_records').select('*').order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    setRecords((data || []).map(r => ({
      id: r.id, title: r.title,
      createdAt: new Date(r.created_at).getTime(),
      rawTranscript: r.raw_transcript,
      metadata: r.metadata as unknown as MeetingMetadata,
    })));
  }, [user]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => {
    const handleResize = () => setIsSidebarOpen(window.innerWidth > 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Load active record data ───────────────────────────────────────────────
  const loadRecordData = useCallback(async (recordId: string) => {
    const rec = records.find(r => r.id === recordId);
    if (!rec) return;
    setLocalMetadata(rec.metadata);
    setLocalTranscript(rec.rawTranscript);

    const { data: tvData } = await supabase.from('transcript_versions').select('*').eq('record_id', recordId).order('version_number', { ascending: true });
    const tvs: TranscriptVersion[] = (tvData || []).map(v => ({
      id: v.id, versionNumber: v.version_number,
      correctedTranscript: v.corrected_transcript,
      correctionLog: v.correction_log || undefined,
      createdAt: new Date(v.created_at).getTime(),
    }));
    setTranscriptVersions(tvs);
    setActiveTranscriptVersion(tvs.length > 0 ? tvs[tvs.length - 1].versionNumber : 1);

    const { data: mvData } = await supabase.from('module_versions').select('*, chat_messages(*)').eq('record_id', recordId).order('version_number', { ascending: true });
    const newMap: Record<string, ModuleVersion[]> = {};
    for (const mv of (mvData || [])) {
      const msgs: ChatMessage[] = ((mv.chat_messages as any[]) || [])
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((m: any) => ({ role: m.role as 'user' | 'model', text: m.content, timestamp: new Date(m.created_at).getTime() }));
      if (!newMap[mv.module_id]) newMap[mv.module_id] = [];
      newMap[mv.module_id].push({ id: mv.id, moduleId: mv.module_id, versionNumber: mv.version_number, createdAt: new Date(mv.created_at).getTime(), messages: msgs });
    }
    setModuleVersionsMap(newMap);
    const initActive: Record<string, number> = {};
    for (const [modId, versions] of Object.entries(newMap)) {
      initActive[modId] = versions[versions.length - 1].versionNumber;
    }
    setActiveModuleVersion(initActive);
  }, [records]);

  useEffect(() => { if (activeRecordId) loadRecordData(activeRecordId); }, [activeRecordId, loadRecordData]);

  const activeRecord = records.find(r => r.id === activeRecordId) || null;
  const currentTranscriptVersion = transcriptVersions.find(v => v.versionNumber === activeTranscriptVersion) || null;

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const createNewRecord = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('meeting_records').insert({
      user_id: user.id, title: '未命名會議分析', raw_transcript: '',
      metadata: { subject: '', keywords: '', speakers: '', terminology: '', length: '' },
    }).select().single();
    if (error || !data) { console.error(error); return; }
    await loadRecords();
    setActiveRecordId(data.id);
    setStep(1);
    setTranscriptVersions([]);
    setModuleVersionsMap({});
    setActiveModuleVersion({});
    setActiveModuleTab('A');
    setErrorMsg(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const deleteRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('確定要刪除此筆記錄嗎？')) return;
    await supabase.from('meeting_records').delete().eq('id', id);
    await loadRecords();
    if (activeRecordId === id) {
      const remaining = records.filter(r => r.id !== id);
      setActiveRecordId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const renameRecord = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentTitle = records.find(r => r.id === id)?.title || '';
    const newTitle = window.prompt('請輸入新名稱', currentTitle);
    if (!newTitle?.trim()) return;
    await supabase.from('meeting_records').update({ title: newTitle.trim() }).eq('id', id);
    await loadRecords();
  };

  // ── Auto-save (debounced) ─────────────────────────────────────────────────
  const saveRecordFields = useCallback(async (fields: Partial<{ metadata: MeetingMetadata; raw_transcript: string }>) => {
    if (!activeRecordId) return;
    await supabase.from('meeting_records').update(fields as any).eq('id', activeRecordId);
  }, [activeRecordId]);

  const handleMetadataChange = (field: keyof MeetingMetadata, value: string) => {
    const updated = { ...localMetadata, [field]: value };
    setLocalMetadata(updated);
    setRecords(prev => prev.map(r => r.id === activeRecordId ? { ...r, metadata: updated } : r));
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveRecordFields({ metadata: updated }), 800);
  };

  const handleTranscriptChange = (value: string) => {
    setLocalTranscript(value);
    setRecords(prev => prev.map(r => r.id === activeRecordId ? { ...r, rawTranscript: value } : r));
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveRecordFields({ raw_transcript: value }), 800);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  // ── AI: Correction ────────────────────────────────────────────────────────
  const runCorrection = async () => {
    if (!activeRecordId || !localTranscript?.trim()) {
      setErrorMsg('請先輸入原始逐字稿內容');
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      setLoadingStep(1); setLoadingLabel('正在上傳數據與會議參數...');
      await new Promise(r => setTimeout(r, 300));

      setLoadingStep(2); setLoadingLabel('AI 引擎正在重構文本脈絡...');
      const result = await geminiService.correctTranscript(localTranscript, localMetadata);

      if (!result?.trim()) throw new Error('AI 回傳空白結果，請稍後重試');

      setLoadingStep(3); setLoadingLabel('正在渲染校正結果...');
      await new Promise(r => setTimeout(r, 200));

      const nextVersion = transcriptVersions.length + 1;
      const { data } = await supabase.from('transcript_versions').insert({
        record_id: activeRecordId, version_number: nextVersion, corrected_transcript: result,
      }).select().single();
      if (data) {
        const newVer: TranscriptVersion = { id: data.id, versionNumber: nextVersion, correctedTranscript: result, createdAt: Date.now() };
        setTranscriptVersions(prev => [...prev, newVer]);
        setActiveTranscriptVersion(nextVersion);
      }
      setStep(2);
    } catch (err: any) {
      setErrorMsg(`校正發生錯誤：${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── AI: Module Analysis ───────────────────────────────────────────────────
  const runInitialAnalysis = async (moduleId: string) => {
    if (!currentTranscriptVersion) {
      setErrorMsg('請先完成逐字稿校正後再執行模組分析');
      return;
    }
    const moduleConfig = INSIGHT_MODULE_CONFIGS[moduleId as keyof typeof INSIGHT_MODULE_CONFIGS];
    if (!moduleConfig) return;

    setErrorMsg(null);
    setIsLoading(true);
    setActiveModuleId(moduleId);

    try {
      setLoadingStep(1); setLoadingLabel(`正在初始化模組「${moduleConfig.name}」...`);
      await new Promise(r => setTimeout(r, 200));

      setLoadingStep(2); setLoadingLabel(`AI 正在深度解讀「${moduleConfig.name}」...`);
      const result = await geminiService.analyzeTranscript(
        currentTranscriptVersion.correctedTranscript,
        moduleId,
        moduleConfig.name,
        []
      );

      if (!result?.trim()) throw new Error('AI 回傳空白結果，請稍後重試');

      setLoadingStep(3); setLoadingLabel('正在渲染分析結果...');
      await new Promise(r => setTimeout(r, 200));

      const existingVersions = moduleVersionsMap[moduleId] || [];
      const nextVersion = existingVersions.length + 1;
      const { data: mvData } = await supabase.from('module_versions').insert({
        record_id: activeRecordId, module_id: moduleId, version_number: nextVersion,
      }).select().single();
      if (!mvData) throw new Error('儲存模組版本失敗');

      const firstMsg: ChatMessage = { role: 'model', text: result, timestamp: Date.now() };
      await supabase.from('chat_messages').insert({ module_version_id: mvData.id, role: 'model', content: result });

      const newModVer: ModuleVersion = { id: mvData.id, moduleId, versionNumber: nextVersion, createdAt: Date.now(), messages: [firstMsg] };
      setModuleVersionsMap(prev => ({ ...prev, [moduleId]: [...(prev[moduleId] || []), newModVer] }));
      setActiveModuleVersion(prev => ({ ...prev, [moduleId]: nextVersion }));
      setStep(3);
    } catch (err: any) {
      setErrorMsg(`分析發生錯誤：${err.message}`);
    } finally {
      setIsLoading(false);
      setActiveModuleId(null);
    }
  };

  // ── AI: Module Chat ────────────────────────────────────────────────────────
  const sendModuleChat = async (moduleId: string) => {
    const input = chatInputs[moduleId];
    if (!input?.trim() || isLoading || !currentTranscriptVersion) return;
    const moduleConfig = INSIGHT_MODULE_CONFIGS[moduleId as keyof typeof INSIGHT_MODULE_CONFIGS];
    const versions = moduleVersionsMap[moduleId] || [];
    const activeVerNum = activeModuleVersion[moduleId] || 1;
    const activeVer = versions.find(v => v.versionNumber === activeVerNum);
    if (!activeVer) return;

    const userMsg: ChatMessage = { role: 'user', text: input, timestamp: Date.now() };
    const updatedMsgs = [...activeVer.messages, userMsg];
    setModuleVersionsMap(prev => ({
      ...prev,
      [moduleId]: prev[moduleId].map(v => v.versionNumber === activeVerNum ? { ...v, messages: updatedMsgs } : v),
    }));
    setChatInputs(prev => ({ ...prev, [moduleId]: '' }));
    setErrorMsg(null);
    setIsLoading(true);
    setActiveModuleId(moduleId);
    setLoadingStep(2);
    setLoadingLabel(`AI 正在針對「${moduleConfig.name}」進行深度回應...`);

    try {
      await supabase.from('chat_messages').insert({ module_version_id: activeVer.id, role: 'user', content: input });
      const response = await geminiService.analyzeTranscript(
        currentTranscriptVersion.correctedTranscript,
        moduleId,
        moduleConfig.name,
        updatedMsgs
      );
      if (!response?.trim()) throw new Error('AI 回傳空白結果');
      const aiMsg: ChatMessage = { role: 'model', text: response, timestamp: Date.now() };
      await supabase.from('chat_messages').insert({ module_version_id: activeVer.id, role: 'model', content: response });
      setModuleVersionsMap(prev => ({
        ...prev,
        [moduleId]: prev[moduleId].map(v => v.versionNumber === activeVerNum ? { ...v, messages: [...updatedMsgs, aiMsg] } : v),
      }));
    } catch (err: any) {
      setErrorMsg(`對話分析發生錯誤：${err.message}`);
    } finally {
      setIsLoading(false);
      setActiveModuleId(null);
    }
  };

  const moduleIds = Object.keys(INSIGHT_MODULE_CONFIGS) as Array<keyof typeof INSIGHT_MODULE_CONFIGS>;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden relative bg-background">
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`fixed lg:relative z-50 transition-all duration-300 ease-out h-full overflow-hidden flex flex-col border-r border-border ${isSidebarOpen ? 'w-[85vw] md:w-64' : 'w-0'}`}
        style={{ background: 'hsl(var(--sidebar-background))' }}>

        <div className="p-5 pb-3 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10">
              <BrainCircuit size={18} className="text-primary" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-foreground whitespace-nowrap">智會洞察</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="p-3">
          <button onClick={createNewRecord}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm transition-all active:scale-95 ios-btn-primary text-primary-foreground">
            <Plus size={15} />新增會議
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="text-[11px] font-semibold tracking-widest uppercase px-2 mb-2 mt-1 text-muted-foreground">歷史記錄</p>
          {records.map(r => (
            <div key={r.id}
              onClick={() => { setActiveRecordId(r.id); setStep(1); setErrorMsg(null); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
              className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all duration-150 mb-0.5 ${activeRecordId === r.id ? 'bg-primary/10' : 'hover:bg-sidebar-accent'}`}>
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`truncate font-medium text-sm ${activeRecordId === r.id ? 'text-primary' : 'text-sidebar-foreground'}`}>{r.title}</span>
                <span className="text-[11px] flex items-center gap-1 mt-0.5 text-muted-foreground">
                  <Clock size={9} /> {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-0.5 lg:opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                <button onClick={e => renameRecord(r.id, e)} className="p-1.5 hover:bg-sidebar-accent rounded-lg transition-colors text-muted-foreground">
                  <Edit3 size={12} />
                </button>
                <button onClick={e => deleteRecord(r.id, e)} className="p-1.5 rounded-lg transition-colors text-muted-foreground hover:text-destructive">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <p className="text-xs text-center py-8 text-muted-foreground">尚無會議記錄</p>
          )}
        </div>

        <div className="p-3 border-t border-border">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs truncate max-w-[160px] text-muted-foreground">{user?.email}</p>
            <button onClick={signOut} className="p-1.5 rounded-lg transition-all hover:text-destructive text-muted-foreground hover:bg-muted" title="登出">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30 border-b border-border ios-glass">
          <div className="flex items-center gap-3">
            {(!isSidebarOpen || window.innerWidth < 1024) && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 rounded-xl transition-all active:scale-90 hover:bg-muted">
                <Menu size={17} className="text-foreground" />
              </button>
            )}
            <h2 className="text-sm font-semibold truncate max-w-[160px] md:max-w-sm text-foreground">
              {activeRecord ? activeRecord.title : '智會洞察助理'}
            </h2>
          </div>
          {activeRecord && (
            <div className="flex items-center bg-muted rounded-xl p-1 gap-0.5">
              {([1, 2, 3] as const).map(s => (
                <button key={s}
                  disabled={(s === 2 || s === 3) && transcriptVersions.length === 0}
                  onClick={() => setStep(s)}
                  className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-all duration-200 ${step === s ? 'ios-tab-active text-primary' : 'text-muted-foreground hover:text-foreground disabled:opacity-30'}`}>
                  {s === 1 ? '輸入' : s === 2 ? '校正' : '解讀'}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-5 pb-24">
          {!activeRecord ? (
            // ── Welcome screen ──
            <div className="h-full flex flex-col items-center justify-center">
              <div className="flex flex-col items-center text-center max-w-md px-4">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 bg-primary/10 shadow-ios-md">
                  <BrainCircuit size={38} className="text-primary" />
                </div>
                <h3 className="text-3xl font-bold mb-3 tracking-tight text-foreground">啟動智慧分析</h3>
                <p className="text-sm mb-8 leading-relaxed text-muted-foreground">透過 AI 深度解析會議數據。選擇一筆記錄或新增會議以啟動系統。</p>
                <button onClick={createNewRecord}
                  className="w-full py-3.5 rounded-2xl font-semibold transition-all active:scale-95 ios-btn-primary text-primary-foreground text-sm">
                  立即建立
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Error Banner */}
              {errorMsg && <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />}

              {/* ── Step 1: Input ── */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="ios-card p-5 md:p-6 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 flex items-center gap-2 mb-1">
                      <Settings size={14} className="text-muted-foreground" />
                      <h3 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">系統參數</h3>
                    </div>
                    {(['subject', 'keywords', 'speakers', 'terminology'] as const).map(field => (
                      <div key={field} className="space-y-1.5">
                        <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
                          {field === 'subject' ? '會議主題' : field === 'keywords' ? '核心關鍵字' : field === 'speakers' ? '出席名單' : '專業術語'}
                        </label>
                        <input type="text" value={localMetadata[field]} onChange={e => handleMetadataChange(field, e.target.value)}
                          placeholder="輸入參數..."
                          className="w-full p-3 rounded-xl text-sm placeholder:text-muted-foreground/40 transition-all ios-input text-foreground" />
                      </div>
                    ))}
                  </div>

                  <div className="ios-card p-5 md:p-6 rounded-2xl">
                    <div className="flex items-center gap-2 mb-4">
                      <Upload size={14} className="text-muted-foreground" />
                      <h3 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">原始逐字稿</h3>
                      <span className="text-[11px] ml-auto text-muted-foreground">{localTranscript.length.toLocaleString()} 字</span>
                    </div>
                    <textarea value={localTranscript} onChange={e => handleTranscriptChange(e.target.value)}
                      placeholder="在此貼上您的會議逐字稿..."
                      className="w-full min-h-[260px] h-72 p-4 rounded-xl text-sm leading-relaxed resize-y placeholder:text-muted-foreground/30 ios-input text-foreground" />
                    <div className="mt-4 flex justify-end">
                      <button disabled={isLoading || !localTranscript?.trim()} onClick={runCorrection}
                        className="w-full md:w-auto px-8 py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2.5 disabled:opacity-30 active:scale-95 ios-btn-primary text-primary-foreground">
                        {isLoading ? <><Loader2 size={15} className="animate-spin" />校正中...</> : <><Zap size={15} />啟動校正引擎</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Correction ── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="ios-card p-5 md:p-6 rounded-2xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-primary/10">
                          <Sparkles size={14} className="text-primary" />
                        </div>
                        <h3 className="text-base font-semibold tracking-tight text-foreground">校正版本</h3>
                      </div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                          <History size={10} /><span>版本歷史</span>
                        </div>
                        <VersionPaginator total={transcriptVersions.length} current={activeTranscriptVersion} onChange={setActiveTranscriptVersion} />
                        <button onClick={() => copyToClipboard(currentTranscriptVersion?.correctedTranscript || '', 'corr')}
                          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3.5 py-2 rounded-xl transition-all active:scale-95 ios-btn-secondary text-muted-foreground">
                          {copiedId === 'corr' ? <Check size={12} /> : <Copy size={12} />}
                          {copiedId === 'corr' ? '已複製' : '複製'}
                        </button>
                      </div>
                    </div>
                    {currentTranscriptVersion && (
                      <p className="text-[11px] mb-3 text-muted-foreground">
                        版本 {currentTranscriptVersion.versionNumber} · {new Date(currentTranscriptVersion.createdAt).toLocaleString()}
                      </p>
                    )}
                    <div className="p-4 rounded-xl whitespace-pre-wrap text-sm leading-relaxed h-[460px] overflow-auto bg-muted/50 border border-border text-foreground">
                      {currentTranscriptVersion?.correctedTranscript || '尚無校正版本'}
                    </div>
                    <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-3">
                      <button onClick={runCorrection} disabled={isLoading || !localTranscript?.trim()}
                        className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-30 ios-btn-secondary text-muted-foreground">
                        <Plus size={14} />重新校正（新版本）
                      </button>
                      <button onClick={() => setStep(3)}
                        className="w-full md:w-auto px-8 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 ios-btn-primary text-primary-foreground">
                        進入解讀矩陣 →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: Insights ── */}
              {step === 3 && (
                <div className="space-y-5 pb-20">
                  {/* Transcript version selector */}
                  {transcriptVersions.length > 1 && (
                    <div className="flex items-center gap-3 ios-card p-3.5 rounded-xl">
                      <p className="text-[11px] font-semibold uppercase tracking-widest whitespace-nowrap text-muted-foreground">分析基底</p>
                      <VersionPaginator total={transcriptVersions.length} current={activeTranscriptVersion} onChange={setActiveTranscriptVersion} />
                      <span className="text-[13px] text-muted-foreground">校正版本 {activeTranscriptVersion}</span>
                    </div>
                  )}

                  {/* ── Module Tabs ── */}
                  <div className="ios-card rounded-2xl overflow-hidden">
                    {/* Tab bar */}
                    <div className="flex border-b border-border bg-muted/40 overflow-x-auto">
                      {moduleIds.map(mId => {
                        const m = INSIGHT_MODULE_CONFIGS[mId];
                        const versions = moduleVersionsMap[mId] || [];
                        const hasResult = versions.length > 0;
                        const isActiveTab = activeModuleTab === mId;
                        const isThisLoading = activeModuleId === mId && isLoading;
                        return (
                          <button
                            key={mId}
                            onClick={() => setActiveModuleTab(mId)}
                            className={`relative flex items-center gap-2 px-4 py-3.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 flex-shrink-0 ${
                              isActiveTab
                                ? 'border-primary text-primary bg-card'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60'
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              {isThisLoading
                                ? <Loader2 size={13} className="animate-spin text-primary" />
                                : <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${hasResult ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{mId}</span>
                              }
                              {m.name}
                            </span>
                            {hasResult && !isThisLoading && (
                              <span className="ml-1 bg-primary/15 text-primary text-[9px] font-bold px-1.5 py-0.5 rounded-full">{versions.length}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tab content */}
                    {moduleIds.map(mId => {
                      if (activeModuleTab !== mId) return null;
                      const m = INSIGHT_MODULE_CONFIGS[mId];
                      const versions = moduleVersionsMap[mId] || [];
                      const hasResult = versions.length > 0;
                      const activeVerNum = activeModuleVersion[mId] || 1;
                      const activeVer = versions.find(v => v.versionNumber === activeVerNum);
                      const chat = activeVer?.messages || [];
                      const lastAiResponse = chat.filter(msg => msg.role === 'model').slice(-1)[0]?.text || '';
                      const copyId = `chat-${mId}`;
                      const isThisLoading = activeModuleId === mId && isLoading;

                      return (
                        <div key={mId}>
                          {!hasResult ? (
                            // ── Empty state for this module ──
                            <div className="py-20 flex flex-col items-center text-center px-6">
                              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-muted">
                                <Sparkles size={24} className="text-muted-foreground" />
                              </div>
                              <h4 className="text-base font-semibold mb-2 text-foreground">{m.name}</h4>
                              <p className="text-sm text-muted-foreground mb-6 max-w-xs">點擊下方按鈕，啟動 AI 對此模組的深度分析</p>
                              <button
                                onClick={() => runInitialAnalysis(mId)}
                                disabled={isLoading || !currentTranscriptVersion}
                                className="px-7 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30 flex items-center gap-2 ios-btn-primary text-primary-foreground"
                              >
                                {isThisLoading
                                  ? <><Loader2 size={14} className="animate-spin" />分析中...</>
                                  : <><Zap size={14} />啟動模組 {mId} 分析</>
                                }
                              </button>
                            </div>
                          ) : (
                            <>
                              {/* Module header */}
                              <div className="px-5 py-3.5 border-b border-border flex flex-col md:flex-row justify-between md:items-center gap-2.5 bg-muted/20">
                                <div className="flex items-center gap-2">
                                  {activeVer && <p className="text-[11px] text-muted-foreground">版本 {activeVer.versionNumber} · {new Date(activeVer.createdAt).toLocaleString()}</p>}
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {versions.length > 1 && (
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                      <History size={10} />版本
                                    </div>
                                  )}
                                  <VersionPaginator total={versions.length} current={activeVerNum}
                                    onChange={v => setActiveModuleVersion(prev => ({ ...prev, [mId]: v }))} />
                                  <button onClick={() => copyToClipboard(lastAiResponse, copyId)}
                                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3.5 py-2 rounded-xl transition-all active:scale-95 ios-btn-secondary text-muted-foreground">
                                    {copiedId === copyId ? <Check size={11} /> : <Copy size={11} />}
                                    {copiedId === copyId ? '已複製' : 'Copy MD'}
                                  </button>
                                  <button
                                    onClick={() => runInitialAnalysis(mId)}
                                    disabled={isLoading || !currentTranscriptVersion}
                                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest px-3.5 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-30 ios-btn-secondary text-muted-foreground"
                                  >
                                    <Plus size={11} />新版本
                                  </button>
                                </div>
                              </div>

                              {/* Chat messages */}
                              <div className="p-5 md:p-6 space-y-5 max-h-[560px] overflow-auto">
                                {chat.map((msg, index) => (
                                  <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] ${msg.role === 'user' ? 'px-4 py-3.5 rounded-2xl rounded-tr-none bg-primary text-primary-foreground' : 'w-full'}`}>
                                      {msg.role === 'user'
                                        ? <p className="font-medium italic text-sm">「{msg.text}」</p>
                                        : <MarkdownRenderer text={msg.text} />}
                                      <div className="mt-1.5 text-[10px] flex items-center gap-1 opacity-50 text-current">
                                        <Clock size={9} /> {new Date(msg.timestamp).toLocaleTimeString()}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {isThisLoading && (
                                  <div className="flex items-center gap-2.5 py-2">
                                    <div className="flex gap-1">
                                      {[0, 1, 2].map(i => (
                                        <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce bg-primary" style={{ animationDelay: `${i * 0.2}s` }} />
                                      ))}
                                    </div>
                                    <span className="text-[13px] text-muted-foreground">AI 思考中...</span>
                                  </div>
                                )}
                              </div>

                              {/* Chat input */}
                              <div className="p-4 border-t border-border bg-muted/20">
                                <div className="flex items-center gap-2.5">
                                  <input type="text" value={chatInputs[mId] || ''} onChange={e => setChatInputs(prev => ({ ...prev, [mId]: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && sendModuleChat(mId)}
                                    placeholder={`針對「${m.name}」深入探討...`}
                                    className="flex-1 p-3.5 rounded-xl text-sm ios-input placeholder:text-muted-foreground/40 text-foreground" />
                                  <button onClick={() => sendModuleChat(mId)} disabled={isLoading || !chatInputs[mId]?.trim()}
                                    className="p-3.5 rounded-xl transition-all disabled:opacity-25 active:scale-95 ios-btn-primary text-primary-foreground">
                                    {isLoading && activeModuleId === mId ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Global Loading Overlay ── */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(6px)' }}>
          <div className="ios-card p-8 rounded-3xl flex flex-col items-center max-w-sm w-full mx-4 shadow-ios-lg">
            <ProgressSteps step={loadingStep} label={loadingLabel} />
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingAssistant;
