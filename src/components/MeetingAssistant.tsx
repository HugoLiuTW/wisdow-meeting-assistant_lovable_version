import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, Edit3, ChevronRight, Clock, FileText,
  Upload, BrainCircuit, Settings, Menu, X, Copy, Check,
  Loader2, Sparkles, Send, MessageSquare, KeyRound
} from 'lucide-react';
import { MeetingRecord, MeetingMetadata, ChatMessage } from '../types';
import { INSIGHT_MODULE_CONFIGS } from '../constants';
import { geminiService } from '../services/geminiService';

const MarkdownRenderer = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
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
      elements.push(
        <p key={i}>
          {parts.map((part, pIdx) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={pIdx}>{part.slice(2, -2)}</strong>
              : part
          )}
        </p>
      );
    }
    i++;
  }
  return <div className="markdown-content">{elements}</div>;
};

const MeetingAssistant: React.FC = () => {
  const [records, setRecords] = useState<MeetingRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('meeting_insights_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const migrated = parsed.map((r: any) => ({ ...r, insightsHistory: r.insightsHistory || {} }));
        setRecords(migrated);
      } catch (e) { console.error('Failed to parse history', e); }
    }
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    const handleResize = () => setIsSidebarOpen(window.innerWidth > 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('meeting_insights_history', JSON.stringify(records));
  }, [records]);

  const activeRecord = records.find(r => r.id === activeRecordId) || null;

  const saveApiKey = () => {
    if (!apiKeyInput.trim()) return;
    setApiKey(apiKeyInput.trim());
    localStorage.setItem('gemini_api_key', apiKeyInput.trim());
    setShowApiKeyModal(false);
    setApiKeyInput('');
  };

  const createNewRecord = () => {
    const newRecord: MeetingRecord = {
      id: Date.now().toString(),
      title: '未命名會議分析',
      createdAt: Date.now(),
      rawTranscript: '',
      metadata: { subject: '', keywords: '', speakers: '', terminology: '', length: '' },
      insights: {},
      insightsHistory: {}
    };
    setRecords([newRecord, ...records]);
    setActiveRecordId(newRecord.id);
    setStep(1);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const deleteRecord = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('確定要刪除此筆記錄嗎？')) {
      const filtered = records.filter(r => r.id !== id);
      setRecords(filtered);
      if (activeRecordId === id) setActiveRecordId(filtered.length > 0 ? filtered[0].id : null);
    }
  };

  const renameRecord = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentTitle = records.find(r => r.id === id)?.title || '';
    const newTitle = window.prompt('請輸入新名稱', currentTitle);
    if (newTitle !== null && newTitle.trim() !== '')
      setRecords(prev => prev.map(r => r.id === id ? { ...r, title: newTitle.trim() } : r));
  };

  const handleMetadataChange = (field: keyof MeetingMetadata, value: string) => {
    if (!activeRecordId) return;
    setRecords(records.map(r => r.id === activeRecordId ? { ...r, metadata: { ...r.metadata, [field]: value } } : r));
  };

  const handleTranscriptChange = (value: string) => {
    if (!activeRecordId) return;
    setRecords(records.map(r => r.id === activeRecordId ? { ...r, rawTranscript: value } : r));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const requireApiKey = (): boolean => {
    if (!apiKey) { setShowApiKeyModal(true); return false; }
    return true;
  };

  const runInitialAnalysis = async (moduleId: string) => {
    if (!activeRecord?.correctedTranscript || !requireApiKey()) return;
    const mId = moduleId as keyof typeof INSIGHT_MODULE_CONFIGS;
    const moduleConfig = INSIGHT_MODULE_CONFIGS[mId];
    if (!moduleConfig) return;

    setIsLoading(true);
    setLoadingText(`正在共振解讀模組「${moduleConfig.name}」...`);
    try {
      const result = await geminiService.analyzeTranscript(activeRecord.correctedTranscript, moduleConfig.prompt, [], apiKey);
      const firstMessage: ChatMessage = { role: 'model', text: result, timestamp: Date.now() };
      setRecords(records.map(r => r.id === activeRecordId ? {
        ...r,
        insights: { ...r.insights, [moduleId]: result },
        insightsHistory: { ...r.insightsHistory, [moduleId]: [firstMessage] }
      } : r));
      setStep(3);
    } catch (error: any) {
      alert(`分析發生錯誤：${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const sendModuleChat = async (moduleId: string) => {
    const input = chatInputs[moduleId];
    if (!activeRecord || !input?.trim() || isLoading || !requireApiKey()) return;

    const mId = moduleId as keyof typeof INSIGHT_MODULE_CONFIGS;
    const moduleConfig = INSIGHT_MODULE_CONFIGS[mId];
    const currentHistory = activeRecord.insightsHistory[moduleId] || [];
    const userMsg: ChatMessage = { role: 'user', text: input, timestamp: Date.now() };
    const updatedHistoryWithUser = [...currentHistory, userMsg];

    setRecords(records.map(r => r.id === activeRecordId ? {
      ...r, insightsHistory: { ...r.insightsHistory, [moduleId]: updatedHistoryWithUser }
    } : r));
    setChatInputs(prev => ({ ...prev, [moduleId]: '' }));
    setIsLoading(true);
    setLoadingText(`AI 正在針對「${moduleConfig.name}」進行深度回應...`);

    try {
      const response = await geminiService.analyzeTranscript(
        activeRecord.correctedTranscript || '',
        moduleConfig.prompt,
        updatedHistoryWithUser,
        apiKey
      );
      const aiMsg: ChatMessage = { role: 'model', text: response, timestamp: Date.now() };
      setRecords(records.map(r => r.id === activeRecordId ? {
        ...r, insightsHistory: { ...r.insightsHistory, [moduleId]: [...updatedHistoryWithUser, aiMsg] }
      } : r));
    } catch (error: any) {
      alert(`對話分析發生錯誤：${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden relative bg-background">
      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-background rounded-3xl p-8 max-w-md w-full shadow-2xl border border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-muted rounded-xl"><KeyRound size={20} className="text-foreground" /></div>
              <h3 className="text-xl font-extrabold tracking-tight">設定 Gemini API Key</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              請輸入您的 Google Gemini API Key。金鑰將儲存於瀏覽器本機，不會上傳至任何伺服器。
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
              placeholder="AIza..."
              className="w-full p-4 bg-muted border border-border rounded-2xl outline-none focus:ring-2 focus:ring-primary/30 text-sm mb-4 font-mono"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowApiKeyModal(false)} className="flex-1 py-3 rounded-2xl border border-border font-bold text-sm hover:bg-muted transition-all">
                取消
              </button>
              <button onClick={saveApiKey} className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-all">
                儲存金鑰
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar overlay for mobile */}
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div className="fixed inset-0 bg-foreground/10 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:relative z-50 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] h-full overflow-hidden flex flex-col bg-sidebar border-r border-sidebar-border ${isSidebarOpen ? 'w-[85vw] md:w-72' : 'w-0'}`}>
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sidebar-accent rounded-xl">
              <BrainCircuit className="text-sidebar-primary" size={20} />
            </div>
            <h1 className="text-lg font-extrabold tracking-tighter text-sidebar-foreground whitespace-nowrap">智會洞察</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 mb-4">
          <button
            onClick={() => { setShowApiKeyModal(true); setApiKeyInput(apiKey); }}
            className="w-full flex items-center gap-2 py-2.5 px-4 rounded-2xl border border-sidebar-border text-xs font-bold text-sidebar-foreground hover:bg-sidebar-accent transition-all"
          >
            <KeyRound size={14} />
            {apiKey ? '已設定 API Key' : '設定 Gemini API Key'}
          </button>
        </div>

        <button onClick={createNewRecord} className="mx-6 mb-6 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 active:scale-95 transition-all font-bold text-sm shadow-sm">
          <Plus size={18} />新增會議
        </button>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 pb-10">
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase px-3 mb-2">歷史記錄</p>
          {records.map(r => (
            <div
              key={r.id}
              onClick={() => { setActiveRecordId(r.id); setStep(r.correctedTranscript ? 3 : 1); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
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
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-16 flex items-center justify-between px-6 md:px-10 sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border">
          <div className="flex items-center gap-4">
            {(!isSidebarOpen || window.innerWidth < 1024) && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-muted rounded-xl hover:bg-accent transition-all active:scale-90">
                <Menu size={20} />
              </button>
            )}
            <h2 className="text-lg font-extrabold tracking-tighter truncate max-w-[180px] md:max-w-none">
              {activeRecord ? activeRecord.title : '智會洞察助理'}
            </h2>
          </div>
          {activeRecord && (
            <div className="flex items-center bg-muted p-1 rounded-2xl">
              {([1, 2, 3] as const).map(s => (
                <button
                  key={s}
                  disabled={s > 1 && !activeRecord.correctedTranscript}
                  onClick={() => setStep(s)}
                  className={`px-4 md:px-6 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${step === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground disabled:opacity-30'}`}
                >
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
              {/* Step 1: Input */}
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
                        <input
                          type="text"
                          value={activeRecord.metadata[field]}
                          onChange={e => handleMetadataChange(field, e.target.value)}
                          placeholder="輸入參數..."
                          className="w-full p-3 md:p-4 bg-background border border-border rounded-2xl focus:ring-2 focus:ring-ring/30 outline-none transition-all text-sm placeholder:text-muted-foreground/50"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="bg-muted p-6 md:p-10 rounded-3xl">
                    <div className="flex items-center gap-3 mb-6">
                      <Upload size={16} className="text-muted-foreground" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">原始逐字稿輸入</h3>
                    </div>
                    <textarea
                      value={activeRecord.rawTranscript}
                      onChange={e => handleTranscriptChange(e.target.value)}
                      placeholder="在此貼上您的會議文本數據..."
                      className="w-full min-h-[300px] h-96 p-6 md:p-8 bg-background border border-border rounded-2xl focus:ring-2 focus:ring-ring/30 outline-none text-sm leading-relaxed resize-y transition-all placeholder:text-muted-foreground/50"
                    />
                    <div className="mt-6 flex justify-end">
                      <button
                        disabled={isLoading || !activeRecord.rawTranscript}
                        onClick={async () => {
                          if (!requireApiKey()) return;
                          setIsLoading(true);
                          setLoadingText('引擎正在重構文本脈絡...');
                          try {
                            const result = await geminiService.correctTranscript(activeRecord.rawTranscript, activeRecord.metadata, apiKey);
                            setRecords(records.map(r => r.id === activeRecordId ? { ...r, correctedTranscript: result } : r));
                            setStep(2);
                          } catch (error: any) {
                            alert(`校正發生錯誤：${error.message}`);
                          } finally { setIsLoading(false); }
                        }}
                        className="w-full md:w-auto bg-primary text-primary-foreground px-12 py-4 rounded-2xl font-bold tracking-tight transition-all flex items-center justify-center gap-3 disabled:opacity-30 active:scale-95 shadow-lg"
                      >
                        {isLoading ? <><Loader2 size={18} className="animate-spin" />校正中...</> : <><span>啟動校正引擎</span><ChevronRight size={18} /></>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Corrected */}
              {step === 2 && (
                <div className="space-y-6 md:space-y-8">
                  <div className="bg-muted p-6 md:p-10 rounded-3xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-background rounded-xl shadow-sm"><Sparkles size={16} /></div>
                        <h3 className="text-lg font-extrabold tracking-tight">校正完成文本</h3>
                      </div>
                      <button
                        onClick={() => copyToClipboard(activeRecord.correctedTranscript || '', 'corr')}
                        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-background px-5 py-2.5 rounded-xl shadow-sm border border-border transition-all hover:text-foreground active:scale-95"
                      >
                        {copiedId === 'corr' ? <Check size={14} /> : <Copy size={14} />}
                        {copiedId === 'corr' ? '已複製' : '複製內容'}
                      </button>
                    </div>
                    <div className="bg-background p-6 md:p-8 rounded-2xl border border-border whitespace-pre-wrap text-sm leading-relaxed h-[500px] overflow-auto resize-y">
                      {activeRecord.correctedTranscript}
                    </div>
                    <div className="mt-6 flex justify-end">
                      <button onClick={() => setStep(3)} className="w-full md:w-auto bg-primary text-primary-foreground px-12 py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 shadow-lg hover:opacity-90">
                        進入解讀矩陣
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Insights */}
              {step === 3 && (
                <div className="space-y-8 md:space-y-10 pb-20">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {(Object.values(INSIGHT_MODULE_CONFIGS) as any[]).map(m => {
                      const hasResult = !!activeRecord.insightsHistory[m.id];
                      const isAnalyzing = isLoading && loadingText.includes(m.name);
                      return (
                        <button
                          key={m.id}
                          onClick={() => runInitialAnalysis(m.id)}
                          disabled={isLoading}
                          className={`flex flex-col items-center justify-center p-4 md:p-6 rounded-3xl transition-all duration-300 relative border active:scale-95 ${hasResult ? 'bg-primary border-primary text-primary-foreground shadow-md' : 'bg-muted border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                        >
                          <div className="mb-2 md:mb-3">{m.icon}</div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-center">{m.name}</span>
                          {isAnalyzing && (
                            <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm rounded-3xl">
                              <Loader2 className="animate-spin" size={22} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-10">
                    {(Object.entries(activeRecord.insightsHistory) as [string, ChatMessage[]][]).map(([id, chat]) => {
                      const m = (INSIGHT_MODULE_CONFIGS as any)[id];
                      const lastAiResponse = chat.filter(msg => msg.role === 'model').slice(-1)[0]?.text || '';
                      const copyId = `chat-${id}`;
                      return (
                        <div key={id} className="bg-muted rounded-3xl overflow-hidden border border-border">
                          <div className="px-6 md:px-10 py-5 border-b border-border bg-background/50 flex flex-col md:flex-row justify-between md:items-center gap-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-background rounded-xl shadow-sm shrink-0 text-foreground">{m.icon}</div>
                              <h4 className="text-base font-extrabold tracking-tight truncate">{m.name}</h4>
                            </div>
                            <button
                              onClick={() => copyToClipboard(lastAiResponse, copyId)}
                              className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground bg-background py-2 px-4 rounded-xl shadow-sm border border-border active:scale-95 transition-all"
                            >
                              {copiedId === copyId ? <Check size={14} /> : <Copy size={14} />}
                              {copiedId === copyId ? '已複製' : '複製 Markdown'}
                            </button>
                          </div>

                          <div className="p-6 md:p-10 space-y-6 max-h-[600px] overflow-auto">
                            {chat.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[90%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground p-5 rounded-3xl rounded-tr-none shadow-sm' : 'w-full'}`}>
                                  {msg.role === 'user'
                                    ? <p className="font-medium italic text-sm">「{msg.text}」</p>
                                    : <MarkdownRenderer text={msg.text} />
                                  }
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
                              <input
                                type="text"
                                value={chatInputs[id] || ''}
                                onChange={e => setChatInputs(prev => ({ ...prev, [id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && sendModuleChat(id)}
                                placeholder={`針對「${m.name}」提出進一步討論...`}
                                className="flex-1 bg-background border border-border rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-ring/20 transition-all placeholder:text-muted-foreground/50"
                              />
                              <button
                                onClick={() => sendModuleChat(id)}
                                disabled={isLoading || !chatInputs[id]?.trim()}
                                className="p-4 bg-primary text-primary-foreground rounded-2xl transition-all disabled:opacity-20 shadow-sm active:scale-95 hover:opacity-90"
                              >
                                {isLoading && loadingText.includes(m.name) ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {Object.keys(activeRecord.insightsHistory).length === 0 && !isLoading && (
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

      {/* Global Loading Overlay */}
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
