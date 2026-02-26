import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Edit3, ChevronRight, Clock,
  Upload, BrainCircuit, Settings, Menu, X, Copy, Check,
  Loader2, Sparkles, Send, MessageSquare, LogOut,
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

// ─── Markdown Renderer ────────────────────────────────────────────────────────
const MarkdownRenderer = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tableLines.push(lines[i]); i++; }
      const headerCells = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
      const bodyRows = tableLines.slice(2).map(row => row.split('|').filter(c => c.trim()).map(c => c.trim()));
      elements.push(
        <div key={`table-${i}`} className="table-wrapper">
          <table><thead><tr>{headerCells.map((cell, idx) => <th key={idx}>{cell}</th>)}</tr></thead>
            <tbody>{bodyRows.map((row, rIdx) => (<tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{cell}</td>)}</tr>))}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith('# ')) elements.push(<h1 key={i}>{line.substring(2)}</h1>);
    else if (line.startsWith('## ')) elements.push(<h2 key={i}>{line.substring(3)}</h2>);
    else if (line.startsWith('### ')) elements.push(<h3 key={i}>{line.substring(4)}</h3>);
    else if (line.startsWith('- ') || line.startsWith('* ')) elements.push(<ul key={i}><li>{line.substring(2)}</li></ul>);
    else if (/^\d+\. /.test(line)) elements.push(<ol key={i}><li>{line.replace(/^\d+\. /, '')}</li></ol>);
    else if (line.trim() === '') elements.push(<div key={i} className="h-3" />);
    else {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      elements.push(<p key={i}>{parts.map((part, pIdx) => part.startsWith('**') && part.endsWith('**') ? <strong key={pIdx}>{part.slice(2, -2)}</strong> : part)}</p>);
    }
    i++;
  }
  return <div className="markdown-content">{elements}</div>;
};

// ─── Version Paginator ────────────────────────────────────────────────────────
function VersionPaginator({ total, current, onChange }: { total: number; current: number; onChange: (v: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 aurora-glass rounded-xl px-2 py-1">
      <button onClick={() => onChange(current - 1)} disabled={current <= 1}
        className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))] disabled:opacity-30 transition-colors">
        <ChevronLeft size={13} />
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => i + 1).map(v => (
          <button key={v} onClick={() => onChange(v)}
            className={`w-6 h-6 rounded-lg text-[10px] font-bold transition-all ${v === current ? 'bg-[hsl(var(--primary))] text-white shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))]'}`}>
            {v}
          </button>
        ))}
      </div>
      <button onClick={() => onChange(current + 1)} disabled={current >= total}
        className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))] disabled:opacity-30 transition-colors">
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
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${s.n === step ? 'aurora-glass-light text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))] opacity-40'}`}>
              {s.n === step && <Loader2 size={12} className="animate-spin" />}
              {s.label}
            </div>
            {idx < 2 && <div className={`w-8 h-px transition-all ${s.n < step ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--border))]'}`} />}
          </React.Fragment>
        ))}
      </div>
      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{label}</p>
    </div>
  );
}

// ─── Error Banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-[hsl(var(--destructive)/0.12)] border border-[hsl(var(--destructive)/0.3)] text-[hsl(var(--destructive))]">
      <AlertCircle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold">發生錯誤</p>
        <p className="text-xs mt-1 opacity-80">{message}</p>
      </div>
      <button onClick={onDismiss} className="p-1 hover:opacity-60 transition-opacity"><X size={16} /></button>
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden relative" style={{ background: 'hsl(var(--background))' }}>
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`fixed lg:relative z-50 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] h-full overflow-hidden flex flex-col border-r ${isSidebarOpen ? 'w-[85vw] md:w-72' : 'w-0'}`}
        style={{ background: 'hsl(var(--sidebar-background))', borderColor: 'hsl(var(--sidebar-border))' }}>

        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl aurora-border-gradient" style={{ background: 'rgba(123, 47, 247, 0.15)' }}>
              <BrainCircuit size={20} className="aurora-text-gradient" style={{ color: 'hsl(var(--accent))' }} />
            </div>
            <h1 className="text-lg font-extrabold tracking-tighter aurora-text-gradient whitespace-nowrap">智會洞察</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"><X size={18} /></button>
        </div>

        <button onClick={createNewRecord}
          className="mx-4 mb-4 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all active:scale-95 aurora-border-gradient"
          style={{ background: 'rgba(0, 245, 255, 0.1)', color: 'hsl(var(--accent))' }}>
          <Plus size={16} />新增會議
        </button>

        <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-4">
          <p className="text-[9px] font-bold tracking-widest uppercase px-3 mb-3" style={{ color: 'hsl(var(--muted-foreground))' }}>歷史記錄</p>
          {records.map(r => (
            <div key={r.id}
              onClick={() => { setActiveRecordId(r.id); setStep(1); setErrorMsg(null); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeRecordId === r.id ? 'aurora-glass-light' : 'hover:bg-[hsl(var(--sidebar-accent))]'}`}>
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`truncate font-semibold text-sm ${activeRecordId === r.id ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--sidebar-foreground))]'}`}>{r.title}</span>
                <span className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <Clock size={9} /> {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-0.5 lg:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                <button onClick={e => renameRecord(r.id, e)} className="p-1.5 hover:bg-[hsl(var(--sidebar-accent))] rounded-lg transition-colors" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <Edit3 size={13} />
                </button>
                <button onClick={e => deleteRecord(r.id, e)} className="p-1.5 rounded-lg transition-colors hover:text-[hsl(var(--destructive))]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <p className="text-xs text-center py-8" style={{ color: 'hsl(var(--muted-foreground))' }}>尚無會議記錄</p>
          )}
        </div>

        <div className="p-4 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs truncate max-w-[160px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{user?.email}</p>
            <button onClick={signOut} className="p-2 rounded-xl transition-all hover:text-[hsl(var(--destructive))]" style={{ color: 'hsl(var(--muted-foreground))' }} title="登出">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-5 md:px-8 sticky top-0 z-30 border-b aurora-glass"
          style={{ borderColor: 'rgba(0, 212, 255, 0.15)' }}>
          <div className="flex items-center gap-3">
            {(!isSidebarOpen || window.innerWidth < 1024) && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 rounded-xl transition-all active:scale-90 aurora-glass-light">
                <Menu size={18} style={{ color: 'hsl(var(--accent))' }} />
              </button>
            )}
            <h2 className="text-base font-extrabold tracking-tighter truncate max-w-[180px] md:max-w-sm aurora-text-gradient">
              {activeRecord ? activeRecord.title : '智會洞察助理'}
            </h2>
          </div>
          {activeRecord && (
            <div className="flex items-center aurora-glass rounded-2xl p-1">
              {([1, 2, 3] as const).map(s => (
                <button key={s}
                  disabled={(s === 2 || s === 3) && transcriptVersions.length === 0}
                  onClick={() => setStep(s)}
                  className={`px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${step === s ? 'aurora-glass-light text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30'}`}>
                  {s === 1 ? '輸入' : s === 2 ? '校正' : '解讀'}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 pb-24">
          {!activeRecord ? (
            // ── Welcome screen ──
            <div className="h-full flex flex-col items-center justify-center">
              <div className="flex flex-col items-center text-center max-w-lg px-4">
                <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-8 aurora-border-gradient" style={{ background: 'rgba(123, 47, 247, 0.15)' }} >
                  <BrainCircuit size={44} className="aurora-text-gradient" style={{ color: 'hsl(var(--accent))' }} />
                </div>
                <h3 className="text-4xl font-extrabold mb-4 tracking-tighter aurora-text-gradient">啟動智慧共振</h3>
                <p className="text-sm mb-10 leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>透過 AI 深度解析會議數據。選擇一筆記錄或新增會議以啟動系統。</p>
                <button onClick={createNewRecord}
                  className="w-full py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 aurora-border-gradient"
                  style={{ background: 'rgba(0, 245, 255, 0.1)', color: 'hsl(var(--accent))' }}>
                  立即啟動
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Error Banner */}
              {errorMsg && <ErrorBanner message={errorMsg} onDismiss={() => setErrorMsg(null)} />}

              {/* ── Step 1: Input ── */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="aurora-glass p-6 md:p-8 rounded-3xl grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 flex items-center gap-3 mb-1">
                      <Settings size={15} style={{ color: 'hsl(var(--muted-foreground))' }} />
                      <h3 className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--muted-foreground))' }}>系統參數初始化</h3>
                    </div>
                    {(['subject', 'keywords', 'speakers', 'terminology'] as const).map(field => (
                      <div key={field} className="space-y-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {field === 'subject' ? '會議主題' : field === 'keywords' ? '核心關鍵字' : field === 'speakers' ? '出席名單' : '專業術語'}
                        </label>
                        <input type="text" value={localMetadata[field]} onChange={e => handleMetadataChange(field, e.target.value)}
                          placeholder="輸入參數..."
                          className="w-full p-3 rounded-2xl outline-none text-sm placeholder:text-[hsl(var(--muted-foreground)/0.4)] transition-all focus:ring-1 focus:ring-[hsl(var(--accent)/0.4)]"
                          style={{ background: 'rgba(0, 212, 255, 0.05)', border: '1px solid rgba(0, 212, 255, 0.2)', color: 'hsl(var(--foreground))' }} />
                      </div>
                    ))}
                  </div>

                  <div className="aurora-glass p-6 md:p-8 rounded-3xl">
                    <div className="flex items-center gap-3 mb-5">
                      <Upload size={15} style={{ color: 'hsl(var(--muted-foreground))' }} />
                      <h3 className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--muted-foreground))' }}>原始逐字稿輸入</h3>
                      <span className="text-[9px] ml-auto" style={{ color: 'hsl(var(--muted-foreground))' }}>{localTranscript.length.toLocaleString()} 字</span>
                    </div>
                    <textarea value={localTranscript} onChange={e => handleTranscriptChange(e.target.value)}
                      placeholder="在此貼上您的會議文本數據..."
                      className="w-full min-h-[280px] h-80 p-5 rounded-2xl outline-none text-sm leading-relaxed resize-y transition-all placeholder:text-[hsl(var(--muted-foreground)/0.3)] focus:ring-1 focus:ring-[hsl(var(--accent)/0.4)]"
                      style={{ background: 'rgba(0, 212, 255, 0.04)', border: '1px solid rgba(0, 212, 255, 0.15)', color: 'hsl(var(--foreground))' }} />
                    <div className="mt-5 flex justify-end">
                      <button disabled={isLoading || !localTranscript?.trim()} onClick={runCorrection}
                        className="w-full md:w-auto px-10 py-4 rounded-2xl font-bold tracking-tight transition-all flex items-center justify-center gap-3 disabled:opacity-30 active:scale-95 aurora-border-gradient"
                        style={{ background: 'rgba(0, 245, 255, 0.12)', color: 'hsl(var(--accent))' }}>
                        {isLoading ? <><Loader2 size={16} className="animate-spin" />校正中...</> : <><Zap size={16} />啟動校正引擎</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Correction ── */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="aurora-glass p-6 md:p-8 rounded-3xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl" style={{ background: 'rgba(0, 245, 255, 0.1)' }}>
                          <Sparkles size={15} style={{ color: 'hsl(var(--accent))' }} />
                        </div>
                        <h3 className="text-base font-extrabold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>校正版本</h3>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          <History size={11} /><span>版本歷史</span>
                        </div>
                        <VersionPaginator total={transcriptVersions.length} current={activeTranscriptVersion} onChange={setActiveTranscriptVersion} />
                        <button onClick={() => copyToClipboard(currentTranscriptVersion?.correctedTranscript || '', 'corr')}
                          className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-all active:scale-95 aurora-glass-light"
                          style={{ color: 'hsl(var(--accent))' }}>
                          {copiedId === 'corr' ? <Check size={13} /> : <Copy size={13} />}
                          {copiedId === 'corr' ? '已複製' : '複製'}
                        </button>
                      </div>
                    </div>
                    {currentTranscriptVersion && (
                      <p className="text-[9px] mb-3 px-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                        版本 {currentTranscriptVersion.versionNumber} · {new Date(currentTranscriptVersion.createdAt).toLocaleString()}
                      </p>
                    )}
                    <div className="p-5 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed h-[480px] overflow-auto"
                      style={{ background: 'rgba(0, 212, 255, 0.04)', border: '1px solid rgba(0, 212, 255, 0.15)', color: 'hsl(var(--foreground))' }}>
                      {currentTranscriptVersion?.correctedTranscript || '尚無校正版本'}
                    </div>
                    <div className="mt-5 flex flex-col md:flex-row items-center justify-between gap-3">
                      <button onClick={runCorrection} disabled={isLoading || !localTranscript?.trim()}
                        className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 disabled:opacity-30 aurora-glass-light"
                        style={{ color: 'hsl(var(--muted-foreground))' }}>
                        <Plus size={15} />重新校正（新版本）
                      </button>
                      <button onClick={() => setStep(3)}
                        className="w-full md:w-auto px-10 py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 aurora-border-gradient"
                        style={{ background: 'rgba(123, 47, 247, 0.15)', color: 'hsl(var(--primary))' }}>
                        進入解讀矩陣 →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: Insights ── */}
              {step === 3 && (
                <div className="space-y-6 pb-20">
                  {/* Transcript version selector */}
                  {transcriptVersions.length > 1 && (
                    <div className="flex items-center gap-3 aurora-glass p-4 rounded-2xl">
                      <p className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'hsl(var(--muted-foreground))' }}>分析基底版本</p>
                      <VersionPaginator total={transcriptVersions.length} current={activeTranscriptVersion} onChange={setActiveTranscriptVersion} />
                      <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>校正版本 {activeTranscriptVersion}</span>
                    </div>
                  )}

                  {/* Module buttons */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {(Object.values(INSIGHT_MODULE_CONFIGS) as any[]).map(m => {
                      const versions = moduleVersionsMap[m.id] || [];
                      const hasResult = versions.length > 0;
                      const isThis = activeModuleId === m.id && isLoading;
                      return (
                        <button key={m.id} onClick={() => runInitialAnalysis(m.id)} disabled={isLoading || !currentTranscriptVersion}
                          className={`flex flex-col items-center justify-center p-4 rounded-3xl transition-all duration-300 relative active:scale-95 aurora-border-gradient ${hasResult ? '' : ''}`}
                          style={{
                            background: hasResult ? 'rgba(123, 47, 247, 0.2)' : 'rgba(0, 212, 255, 0.05)',
                            color: hasResult ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                          }}>
                          <div className={`mb-2 ${hasResult ? '' : ''}`}>{m.icon}</div>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-center leading-tight">{m.name}</span>
                          {hasResult && <span className="text-[8px] mt-1 opacity-60">共 {versions.length} 版</span>}
                          {isThis && (
                            <div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm rounded-3xl" style={{ background: 'rgba(10, 14, 39, 0.7)' }}>
                              <Loader2 className="animate-spin" size={20} style={{ color: 'hsl(var(--accent))' }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Module results */}
                  <div className="space-y-8">
                    {Object.entries(moduleVersionsMap).map(([moduleId, versions]) => {
                      if (versions.length === 0) return null;
                      const m = (INSIGHT_MODULE_CONFIGS as any)[moduleId];
                      const activeVerNum = activeModuleVersion[moduleId] || 1;
                      const activeVer = versions.find(v => v.versionNumber === activeVerNum);
                      const chat = activeVer?.messages || [];
                      const lastAiResponse = chat.filter(msg => msg.role === 'model').slice(-1)[0]?.text || '';
                      const copyId = `chat-${moduleId}`;

                      return (
                        <div key={moduleId} className="aurora-glass rounded-3xl overflow-hidden">
                          {/* Module header */}
                          <div className="px-6 md:px-8 py-5 border-b flex flex-col md:flex-row justify-between md:items-center gap-3"
                            style={{ borderColor: 'rgba(0, 212, 255, 0.15)', background: 'rgba(0, 212, 255, 0.04)' }}>
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-xl shrink-0" style={{ background: 'rgba(123, 47, 247, 0.15)', color: 'hsl(var(--primary))' }}>{m.icon}</div>
                              <div>
                                <h4 className="text-sm font-extrabold tracking-tight" style={{ color: 'hsl(var(--foreground))' }}>{m.name}</h4>
                                {activeVer && <p className="text-[9px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>{new Date(activeVer.createdAt).toLocaleString()}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                <History size={11} />版本
                              </div>
                              <VersionPaginator total={versions.length} current={activeVerNum}
                                onChange={v => setActiveModuleVersion(prev => ({ ...prev, [moduleId]: v }))} />
                              <button onClick={() => copyToClipboard(lastAiResponse, copyId)}
                                className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-all active:scale-95 aurora-glass-light"
                                style={{ color: 'hsl(var(--accent))' }}>
                                {copiedId === copyId ? <Check size={12} /> : <Copy size={12} />}
                                {copiedId === copyId ? '已複製' : 'Copy MD'}
                              </button>
                            </div>
                          </div>

                          {/* Chat messages */}
                          <div className="p-6 md:p-8 space-y-5 max-h-[560px] overflow-auto">
                            {chat.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[90%] ${msg.role === 'user' ? 'px-5 py-4 rounded-3xl rounded-tr-none' : 'w-full'}`}
                                  style={msg.role === 'user' ? { background: 'rgba(123, 47, 247, 0.2)', border: '1px solid rgba(123, 47, 247, 0.4)', color: 'hsl(var(--foreground))' } : {}}>
                                  {msg.role === 'user'
                                    ? <p className="font-medium italic text-sm">「{msg.text}」</p>
                                    : <MarkdownRenderer text={msg.text} />}
                                  <div className="mt-1.5 text-[9px] flex items-center gap-1 opacity-50" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                    <Clock size={9} /> {new Date(msg.timestamp).toLocaleTimeString()}
                                  </div>
                                </div>
                              </div>
                            ))}
                            {activeModuleId === moduleId && isLoading && (
                              <div className="flex items-center gap-3 py-3">
                                <div className="flex gap-1.5">
                                  {[0, 1, 2].map(i => (
                                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'hsl(var(--accent))', animationDelay: `${i * 0.2}s` }} />
                                  ))}
                                </div>
                                <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>AI 思考中...</span>
                              </div>
                            )}
                          </div>

                          {/* Chat input */}
                          <div className="p-5 border-t" style={{ borderColor: 'rgba(0, 212, 255, 0.15)', background: 'rgba(0, 212, 255, 0.03)' }}>
                            <div className="flex items-center gap-3">
                              <input type="text" value={chatInputs[moduleId] || ''} onChange={e => setChatInputs(prev => ({ ...prev, [moduleId]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && sendModuleChat(moduleId)}
                                placeholder={`針對「${m.name}」提出進一步討論...`}
                                className="flex-1 p-4 rounded-2xl text-sm outline-none transition-all placeholder:text-[hsl(var(--muted-foreground)/0.4)] focus:ring-1 focus:ring-[hsl(var(--accent)/0.3)]"
                                style={{ background: 'rgba(0, 212, 255, 0.05)', border: '1px solid rgba(0, 212, 255, 0.15)', color: 'hsl(var(--foreground))' }} />
                              <button onClick={() => sendModuleChat(moduleId)} disabled={isLoading || !chatInputs[moduleId]?.trim()}
                                className="p-4 rounded-2xl transition-all disabled:opacity-20 active:scale-95 aurora-border-gradient"
                                style={{ background: 'rgba(0, 245, 255, 0.1)', color: 'hsl(var(--accent))' }}>
                                {isLoading && activeModuleId === moduleId ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {Object.keys(moduleVersionsMap).length === 0 && !isLoading && (
                      <div className="py-24 text-center aurora-glass rounded-3xl">
                        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-6 aurora-border-gradient" style={{ background: 'rgba(0, 212, 255, 0.08)' }}>
                          <Sparkles size={28} style={{ color: 'hsl(var(--accent))' }} />
                        </div>
                        <h4 className="text-2xl font-extrabold mb-3 tracking-tighter aurora-text-gradient">解讀矩陣待命中</h4>
                        <p className="text-sm max-w-md mx-auto" style={{ color: 'hsl(var(--muted-foreground))' }}>點擊上方模組標籤，啟動對特定內容的深度分析。</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Global Loading Overlay ── */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none" style={{ background: 'rgba(10, 14, 39, 0.75)', backdropFilter: 'blur(8px)' }}>
          <div className="aurora-glass p-10 rounded-3xl flex flex-col items-center max-w-sm w-full mx-4">
            <ProgressSteps step={loadingStep} label={loadingLabel} />
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingAssistant;
