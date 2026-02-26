import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, ChevronRight, Clock,
  Upload, BrainCircuit, Settings, Menu, X, Copy, Check,
  Loader2, Sparkles, Send, MessageSquare, LogOut,
  ChevronLeft, History
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
          <table>
            <thead><tr>{headerCells.map((cell, idx) => <th key={idx}>{cell}</th>)}</tr></thead>
            <tbody>{bodyRows.map((row, rIdx) => (
              <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{cell}</td>)}</tr>
            ))}</tbody>
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
    else if (line.trim() === '') elements.push(<div key={i} className="h-4" />);
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
    <div className="flex items-center gap-2 bg-muted rounded-xl p-1">
      <button
        onClick={() => onChange(current - 1)}
        disabled={current <= 1}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
      ><ChevronLeft size={14} /></button>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }, (_, i) => i + 1).map(v => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`w-6 h-6 rounded-lg text-[10px] font-bold transition-all ${v === current ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >{v}</button>
        ))}
      </div>
      <button
        onClick={() => onChange(current + 1)}
        disabled={current >= total}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
      ><ChevronRight size={14} /></button>
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
  const [loadingText, setLoadingText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});

  // Per-record state
  const [localMetadata, setLocalMetadata] = useState<MeetingMetadata>({ subject: '', keywords: '', speakers: '', terminology: '', length: '' });
  const [localTranscript, setLocalTranscript] = useState('');

  // Versioned transcript data
  const [transcriptVersions, setTranscriptVersions] = useState<TranscriptVersion[]>([]);
  const [activeTranscriptVersion, setActiveTranscriptVersion] = useState(1);

  // Module versions: { moduleId -> versions[] }
  const [moduleVersionsMap, setModuleVersionsMap] = useState<Record<string, ModuleVersion[]>>({});
  // Active version per module
  const [activeModuleVersion, setActiveModuleVersion] = useState<Record<string, number>>({});

  // ── Load records ─────────────────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('meeting_records')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    setRecords((data || []).map(r => ({
      id: r.id,
      title: r.title,
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

  // ── Load active record data ────────────────────────────────────────────────
  const loadRecordData = useCallback(async (recordId: string) => {
    const rec = records.find(r => r.id === recordId);
    if (!rec) return;
    setLocalMetadata(rec.metadata);
    setLocalTranscript(rec.rawTranscript);

    // Load transcript versions
    const { data: tvData } = await supabase
      .from('transcript_versions')
      .select('*')
      .eq('record_id', recordId)
      .order('version_number', { ascending: true });
    const tvs: TranscriptVersion[] = (tvData || []).map(v => ({
      id: v.id,
      versionNumber: v.version_number,
      correctedTranscript: v.corrected_transcript,
      correctionLog: v.correction_log || undefined,
      createdAt: new Date(v.created_at).getTime(),
    }));
    setTranscriptVersions(tvs);
    setActiveTranscriptVersion(tvs.length > 0 ? tvs[tvs.length - 1].versionNumber : 1);

    // Load module versions
    const { data: mvData } = await supabase
      .from('module_versions')
      .select('*, chat_messages(*)')
      .eq('record_id', recordId)
      .order('version_number', { ascending: true });

    const newMap: Record<string, ModuleVersion[]> = {};
    for (const mv of (mvData || [])) {
      const msgs: ChatMessage[] = ((mv.chat_messages as any[]) || [])
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((m: any) => ({ role: m.role as 'user' | 'model', text: m.content, timestamp: new Date(m.created_at).getTime() }));
      if (!newMap[mv.module_id]) newMap[mv.module_id] = [];
      newMap[mv.module_id].push({ id: mv.id, moduleId: mv.module_id, versionNumber: mv.version_number, createdAt: new Date(mv.created_at).getTime(), messages: msgs });
    }
    setModuleVersionsMap(newMap);

    // Set active version to latest for each module
    const initActive: Record<string, number> = {};
    for (const [modId, versions] of Object.entries(newMap)) {
      initActive[modId] = versions[versions.length - 1].versionNumber;
    }
    setActiveModuleVersion(initActive);
  }, [records]);

  useEffect(() => {
    if (activeRecordId) loadRecordData(activeRecordId);
  }, [activeRecordId, loadRecordData]);

  const activeRecord = records.find(r => r.id === activeRecordId) || null;
  const currentTranscriptVersion = transcriptVersions.find(v => v.versionNumber === activeTranscriptVersion) || null;

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const createNewRecord = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('meeting_records').insert({
      user_id: user.id,
      title: '未命名會議分析',
      raw_transcript: '',
      metadata: { subject: '', keywords: '', speakers: '', terminology: '', length: '' },
    }).select().single();
    if (error || !data) { console.error(error); return; }
    await loadRecords();
    setActiveRecordId(data.id);
    setStep(1);
    setTranscriptVersions([]);
    setModuleVersionsMap({});
    setActiveModuleVersion({});
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

  // ── Auto-save metadata & transcript ───────────────────────────────────────
  const saveRecordFields = useCallback(async (fields: Partial<{ metadata: MeetingMetadata; raw_transcript: string }>) => {
    if (!activeRecordId) return;
    await supabase.from('meeting_records').update(fields as any).eq('id', activeRecordId);
  }, [activeRecordId]);

  const handleMetadataChange = (field: keyof MeetingMetadata, value: string) => {
    const updated = { ...localMetadata, [field]: value };
    setLocalMetadata(updated);
    setRecords(prev => prev.map(r => r.id === activeRecordId ? { ...r, metadata: updated } : r));
    saveRecordFields({ metadata: updated });
  };

  const handleTranscriptChange = (value: string) => {
    setLocalTranscript(value);
    setRecords(prev => prev.map(r => r.id === activeRecordId ? { ...r, rawTranscript: value } : r));
    saveRecordFields({ raw_transcript: value });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  };

  // ── AI Actions ────────────────────────────────────────────────────────────
  const runCorrection = async () => {
    if (!activeRecordId || !localTranscript) return;
    setIsLoading(true);
    setLoadingText('引擎正在重構文本脈絡...');
    try {
      const result = await geminiService.correctTranscript(localTranscript, localMetadata);
      const nextVersion = transcriptVersions.length + 1;
      const { data } = await supabase.from('transcript_versions').insert({
        record_id: activeRecordId,
        version_number: nextVersion,
        corrected_transcript: result,
      }).select().single();
      if (data) {
        const newVer: TranscriptVersion = { id: data.id, versionNumber: nextVersion, correctedTranscript: result, createdAt: Date.now() };
        setTranscriptVersions(prev => [...prev, newVer]);
        setActiveTranscriptVersion(nextVersion);
      }
      setStep(2);
    } catch (err: any) { alert(`校正發生錯誤：${err.message}`); }
    finally { setIsLoading(false); }
  };

  const runInitialAnalysis = async (moduleId: string) => {
    if (!currentTranscriptVersion) return;
    const moduleConfig = INSIGHT_MODULE_CONFIGS[moduleId as keyof typeof INSIGHT_MODULE_CONFIGS];
    if (!moduleConfig) return;

    setIsLoading(true);
    setLoadingText(`正在共振解讀模組「${moduleConfig.name}」...`);
    try {
      const result = await geminiService.analyzeTranscript(currentTranscriptVersion.correctedTranscript, moduleConfig.prompt, []);
      const existingVersions = moduleVersionsMap[moduleId] || [];
      const nextVersion = existingVersions.length + 1;
      const { data: mvData } = await supabase.from('module_versions').insert({
        record_id: activeRecordId,
        module_id: moduleId,
        version_number: nextVersion,
      }).select().single();
      if (!mvData) return;

      const firstMsg: ChatMessage = { role: 'model', text: result, timestamp: Date.now() };
      await supabase.from('chat_messages').insert({ module_version_id: mvData.id, role: 'model', content: result });

      const newModVer: ModuleVersion = { id: mvData.id, moduleId, versionNumber: nextVersion, createdAt: Date.now(), messages: [firstMsg] };
      setModuleVersionsMap(prev => ({ ...prev, [moduleId]: [...(prev[moduleId] || []), newModVer] }));
      setActiveModuleVersion(prev => ({ ...prev, [moduleId]: nextVersion }));
      setStep(3);
    } catch (err: any) { alert(`分析發生錯誤：${err.message}`); }
    finally { setIsLoading(false); }
  };

  const sendModuleChat = async (moduleId: string) => {
    const input = chatInputs[moduleId];
    if (!activeRecord || !input?.trim() || isLoading || !currentTranscriptVersion) return;
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
    setIsLoading(true);
    setLoadingText(`AI 正在針對「${moduleConfig.name}」進行深度回應...`);

    try {
      await supabase.from('chat_messages').insert({ module_version_id: activeVer.id, role: 'user', content: input });
      const response = await geminiService.analyzeTranscript(currentTranscriptVersion.correctedTranscript, moduleConfig.prompt, updatedMsgs);
      const aiMsg: ChatMessage = { role: 'model', text: response, timestamp: Date.now() };
      await supabase.from('chat_messages').insert({ module_version_id: activeVer.id, role: 'model', content: response });

      setModuleVersionsMap(prev => ({
        ...prev,
        [moduleId]: prev[moduleId].map(v => v.versionNumber === activeVerNum ? { ...v, messages: [...updatedMsgs, aiMsg] } : v),
      }));
    } catch (err: any) { alert(`對話分析發生錯誤：${err.message}`); }
    finally { setIsLoading(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden relative bg-background">
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div className="fixed inset-0 bg-foreground/10 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:relative z-50 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] h-full overflow-hidden flex flex-col bg-sidebar border-r border-sidebar-border ${isSidebarOpen ? 'w-[85vw] md:w-72' : 'w-0'}`}>
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sidebar-accent rounded-xl"><BrainCircuit className="text-sidebar-primary" size={20} /></div>
            <h1 className="text-lg font-extrabold tracking-tighter text-sidebar-foreground whitespace-nowrap">智會洞察</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X size={20} /></button>
        </div>

        <button onClick={createNewRecord} className="mx-6 mb-4 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 active:scale-95 transition-all font-bold text-sm shadow-sm">
          <Plus size={18} />新增會議
        </button>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 pb-4">
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase px-3 mb-2">歷史記錄</p>
          {records.map(r => (
            <div
              key={r.id}
              onClick={() => { setActiveRecordId(r.id); setStep(1); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
              className={`group flex items-center justify-between p-3 px-4 rounded-2xl cursor-pointer transition-all duration-300 ${activeRecordId === r.id ? 'bg-background shadow-sm' : 'hover:bg-sidebar-accent'}`}
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className={`truncate font-semibold text-sm ${activeRecordId === r.id ? 'text-foreground' : 'text-sidebar-foreground/70'}`}>{r.title}</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <Clock size={10} /> {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-1 lg:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                <button onClick={e => renameRecord(r.id, e)} className="p-1.5 hover:bg-sidebar-accent rounded-lg text-muted-foreground hover:text-foreground transition-colors"><Edit3 size={14} /></button>
                <button onClick={e => deleteRecord(r.id, e)} className="p-1.5 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* User info + sign out */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground truncate max-w-[160px]">{user?.email}</p>
            <button onClick={signOut} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-all" title="登出">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-16 flex items-center justify-between px-6 md:px-10 sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border">
          <div className="flex items-center gap-4">
            {(!isSidebarOpen || window.innerWidth < 1024) && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-muted rounded-xl hover:bg-accent transition-all active:scale-90"><Menu size={20} /></button>
            )}
            <h2 className="text-lg font-extrabold tracking-tighter truncate max-w-[180px] md:max-w-none">
              {activeRecord ? activeRecord.title : '智會洞察助理'}
            </h2>
          </div>
          {activeRecord && (
            <div className="flex items-center bg-muted p-1 rounded-2xl">
              {([1, 2, 3] as const).map(s => (
                <button key={s} disabled={s > 1 && transcriptVersions.length === 0} onClick={() => setStep(s)}
                  className={`px-4 md:px-6 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${step === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground disabled:opacity-30'}`}>
                  {s === 1 ? '輸入' : s === 2 ? '校正' : '解讀'}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 md:px-10 pt-6 pb-24">
          {!activeRecord ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="flex flex-col items-center text-center max-w-lg px-4">
                <div className="w-20 h-20 bg-muted rounded-3xl flex items-center justify-center mb-8">
                  <BrainCircuit size={40} className="text-foreground" />
                </div>
                <h3 className="text-3xl font-extrabold mb-4 tracking-tighter">啟動智慧共振</h3>
                <p className="text-muted-foreground mb-10 leading-relaxed">透過 AI 深度解析會議數據。選擇一筆記錄或新增會議以啟動系統。</p>
                <button onClick={createNewRecord} className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 shadow-lg hover:opacity-90">
                  立即啟動
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto">

              {/* ── Step 1: Input ── */}
              {step === 1 && (
                <div className="space-y-6 md:space-y-8">
                  <div className="bg-muted p-6 md:p-10 rounded-3xl grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div className="md:col-span-2 flex items-center gap-3 mb-2">
                      <Settings size={16} className="text-muted-foreground" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">系統參數初始化</h3>
                    </div>
                    {(['subject', 'keywords', 'speakers', 'terminology'] as const).map(field => (
                      <div key={field} className="space-y-2">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
                          {field === 'subject' ? '會議主題' : field === 'keywords' ? '核心關鍵字' : field === 'speakers' ? '出席名單' : '專業術語'}
                        </label>
                        <input type="text" value={localMetadata[field]} onChange={e => handleMetadataChange(field, e.target.value)}
                          placeholder="輸入參數..."
                          className="w-full p-3 md:p-4 bg-background border border-border rounded-2xl focus:ring-2 focus:ring-ring/30 outline-none transition-all text-sm placeholder:text-muted-foreground/50" />
                      </div>
                    ))}
                  </div>
                  <div className="bg-muted p-6 md:p-10 rounded-3xl">
                    <div className="flex items-center gap-3 mb-6">
                      <Upload size={16} className="text-muted-foreground" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">原始逐字稿輸入</h3>
                    </div>
                    <textarea value={localTranscript} onChange={e => handleTranscriptChange(e.target.value)}
                      placeholder="在此貼上您的會議文本數據..."
                      className="w-full min-h-[300px] h-96 p-6 md:p-8 bg-background border border-border rounded-2xl focus:ring-2 focus:ring-ring/30 outline-none text-sm leading-relaxed resize-y transition-all placeholder:text-muted-foreground/50" />
                    <div className="mt-6 flex justify-end">
                      <button disabled={isLoading || !localTranscript} onClick={runCorrection}
                        className="w-full md:w-auto bg-primary text-primary-foreground px-12 py-4 rounded-2xl font-bold tracking-tight transition-all flex items-center justify-center gap-3 disabled:opacity-30 active:scale-95 shadow-lg">
                        {isLoading ? <><Loader2 size={18} className="animate-spin" />校正中...</> : <><span>啟動校正引擎</span><ChevronRight size={18} /></>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: Corrected (with version pagination) ── */}
              {step === 2 && (
                <div className="space-y-6 md:space-y-8">
                  <div className="bg-muted p-6 md:p-10 rounded-3xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-background rounded-xl shadow-sm"><Sparkles size={16} /></div>
                        <h3 className="text-lg font-extrabold tracking-tight">校正版本</h3>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                          <History size={12} />
                          <span>版本歷史</span>
                        </div>
                        <VersionPaginator
                          total={transcriptVersions.length}
                          current={activeTranscriptVersion}
                          onChange={setActiveTranscriptVersion}
                        />
                        <button onClick={() => copyToClipboard(currentTranscriptVersion?.correctedTranscript || '', 'corr')}
                          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-background px-5 py-2.5 rounded-xl shadow-sm border border-border transition-all hover:text-foreground active:scale-95">
                          {copiedId === 'corr' ? <Check size={14} /> : <Copy size={14} />}
                          {copiedId === 'corr' ? '已複製' : '複製內容'}
                        </button>
                      </div>
                    </div>
                    {currentTranscriptVersion && (
                      <div className="text-[10px] text-muted-foreground mb-3 px-1">
                        版本 {currentTranscriptVersion.versionNumber} · {new Date(currentTranscriptVersion.createdAt).toLocaleString()}
                      </div>
                    )}
                    <div className="bg-background p-6 md:p-8 rounded-2xl border border-border whitespace-pre-wrap text-sm leading-relaxed h-[500px] overflow-auto resize-y">
                      {currentTranscriptVersion?.correctedTranscript || '尚無校正版本'}
                    </div>
                    <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4">
                      <button onClick={runCorrection} disabled={isLoading || !localTranscript}
                        className="w-full md:w-auto flex items-center justify-center gap-2 border border-border bg-background px-8 py-3 rounded-2xl text-sm font-bold text-muted-foreground hover:text-foreground transition-all active:scale-95 disabled:opacity-30">
                        <Plus size={16} />重新校正（新版本）
                      </button>
                      <button onClick={() => setStep(3)}
                        className="w-full md:w-auto bg-primary text-primary-foreground px-12 py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 shadow-lg hover:opacity-90">
                        進入解讀矩陣
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: Insights (with version pagination per module) ── */}
              {step === 3 && (
                <div className="space-y-8 md:space-y-10 pb-20">
                  {/* Transcript version selector */}
                  {transcriptVersions.length > 1 && (
                    <div className="flex items-center gap-3 bg-muted p-4 rounded-2xl">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">分析基底</div>
                      <VersionPaginator total={transcriptVersions.length} current={activeTranscriptVersion} onChange={setActiveTranscriptVersion} />
                      <span className="text-xs text-muted-foreground">校正版本 {activeTranscriptVersion}</span>
                    </div>
                  )}

                  {/* Module buttons */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {(Object.values(INSIGHT_MODULE_CONFIGS) as any[]).map(m => {
                      const versions = moduleVersionsMap[m.id] || [];
                      const hasResult = versions.length > 0;
                      const isAnalyzing = isLoading && loadingText.includes(m.name);
                      return (
                        <button key={m.id} onClick={() => runInitialAnalysis(m.id)} disabled={isLoading || !currentTranscriptVersion}
                          className={`flex flex-col items-center justify-center p-4 md:p-6 rounded-3xl transition-all duration-300 relative border active:scale-95 ${hasResult ? 'bg-primary border-primary text-primary-foreground shadow-md' : 'bg-muted border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                          <div className="mb-2 md:mb-3">{m.icon}</div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-center">{m.name}</span>
                          {hasResult && <span className="text-[8px] mt-1 opacity-70">共 {versions.length} 版</span>}
                          {isAnalyzing && (
                            <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm rounded-3xl">
                              <Loader2 className="animate-spin" size={22} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Module results */}
                  <div className="space-y-10">
                    {Object.entries(moduleVersionsMap).map(([moduleId, versions]) => {
                      if (versions.length === 0) return null;
                      const m = (INSIGHT_MODULE_CONFIGS as any)[moduleId];
                      const activeVerNum = activeModuleVersion[moduleId] || 1;
                      const activeVer = versions.find(v => v.versionNumber === activeVerNum);
                      const chat = activeVer?.messages || [];
                      const lastAiResponse = chat.filter(msg => msg.role === 'model').slice(-1)[0]?.text || '';
                      const copyId = `chat-${moduleId}`;

                      return (
                        <div key={moduleId} className="bg-muted rounded-3xl overflow-hidden border border-border">
                          <div className="px-6 md:px-10 py-5 border-b border-border bg-background/50 flex flex-col md:flex-row justify-between md:items-center gap-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-background rounded-xl shadow-sm shrink-0 text-foreground">{m.icon}</div>
                              <div>
                                <h4 className="text-base font-extrabold tracking-tight">{m.name}</h4>
                                {activeVer && <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(activeVer.createdAt).toLocaleString()}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                                <History size={12} />版本
                              </div>
                              <VersionPaginator
                                total={versions.length}
                                current={activeVerNum}
                                onChange={v => setActiveModuleVersion(prev => ({ ...prev, [moduleId]: v }))}
                              />
                              <button onClick={() => copyToClipboard(lastAiResponse, copyId)}
                                className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground bg-background py-2 px-4 rounded-xl shadow-sm border border-border active:scale-95 transition-all">
                                {copiedId === copyId ? <Check size={14} /> : <Copy size={14} />}
                                {copiedId === copyId ? '已複製' : '複製 Markdown'}
                              </button>
                            </div>
                          </div>

                          <div className="p-6 md:p-10 space-y-6 max-h-[600px] overflow-auto">
                            {chat.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[90%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground p-5 rounded-3xl rounded-tr-none shadow-sm' : 'w-full'}`}>
                                  {msg.role === 'user' ? <p className="font-medium italic text-sm">「{msg.text}」</p> : <MarkdownRenderer text={msg.text} />}
                                  <div className={`mt-2 text-[10px] flex items-center gap-1 opacity-60 ${msg.role === 'user' ? '' : 'text-muted-foreground'}`}>
                                    <Clock size={10} /> {new Date(msg.timestamp).toLocaleTimeString()}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="p-6 md:p-8 bg-background/50 border-t border-border">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-background rounded-xl text-muted-foreground shrink-0 shadow-sm"><MessageSquare size={18} /></div>
                              <input type="text" value={chatInputs[moduleId] || ''} onChange={e => setChatInputs(prev => ({ ...prev, [moduleId]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && sendModuleChat(moduleId)}
                                placeholder={`針對「${m.name}」提出進一步討論...`}
                                className="flex-1 bg-background border border-border rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-ring/20 transition-all placeholder:text-muted-foreground/50" />
                              <button onClick={() => sendModuleChat(moduleId)} disabled={isLoading || !chatInputs[moduleId]?.trim()}
                                className="p-4 bg-primary text-primary-foreground rounded-2xl transition-all disabled:opacity-20 shadow-sm active:scale-95 hover:opacity-90">
                                {isLoading && loadingText.includes(m.name) ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {Object.keys(moduleVersionsMap).length === 0 && !isLoading && (
                      <div className="py-24 text-center">
                        <div className="w-16 h-16 bg-muted rounded-3xl flex items-center justify-center mx-auto mb-8">
                          <Sparkles size={32} className="text-muted-foreground" />
                        </div>
                        <h4 className="text-2xl font-extrabold mb-4 tracking-tighter">解讀矩陣待命中</h4>
                        <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">點擊上方模組標籤，啟動對特定內容的深度分析。</p>
                      </div>
                    )}

                    {isLoading && (
                      <div className="py-20 text-center bg-muted rounded-3xl">
                        <Loader2 className="animate-spin mx-auto mb-6" size={44} />
                        <p className="text-xl font-extrabold tracking-tighter mb-2">{loadingText}</p>
                        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Processing Insight Matrix</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {isLoading && step !== 3 && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-[100] flex items-center justify-center pointer-events-none">
          <div className="bg-muted p-10 rounded-3xl flex flex-col items-center shadow-2xl border border-border">
            <Loader2 className="animate-spin mb-6" size={44} />
            <p className="text-sm font-bold tracking-widest uppercase">{loadingText}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingAssistant;
