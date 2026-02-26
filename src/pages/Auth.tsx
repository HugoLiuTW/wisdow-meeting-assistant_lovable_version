import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BrainCircuit, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

type Mode = 'login' | 'signup';

const Auth: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage({ type: 'success', text: '帳號建立成功！請至信箱確認驗證信件後登入。' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      const msg = err.message || '操作失敗，請稍後再試';
      if (msg.includes('Invalid login credentials')) setMessage({ type: 'error', text: '帳號或密碼錯誤，請確認後重試' });
      else if (msg.includes('Email not confirmed')) setMessage({ type: 'error', text: '請先驗證您的電子郵件後再登入' });
      else if (msg.includes('User already registered')) setMessage({ type: 'error', text: '此電子郵件已被使用' });
      else setMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    background: 'rgba(0, 212, 255, 0.05)',
    border: '1px solid rgba(0, 212, 255, 0.2)',
    borderRadius: '16px',
    outline: 'none',
    color: 'hsl(200, 100%, 96%)',
    fontSize: '14px',
    transition: 'all 0.2s',
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'hsl(230, 45%, 7%)',
        backgroundImage: `
          radial-gradient(ellipse at 20% 30%, rgba(0, 245, 255, 0.07) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, rgba(123, 47, 247, 0.1) 0%, transparent 50%)
        `,
      }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="p-5 rounded-3xl mb-5 aurora-border-gradient" style={{ background: 'rgba(123, 47, 247, 0.15)' }}>
            <BrainCircuit size={40} style={{ color: '#00F5FF' }} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tighter aurora-text-gradient">智會洞察</h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(200, 240, 255, 0.5)' }}>AI 驅動的會議深度分析系統</p>
        </div>

        {/* Mode toggle */}
        <div className="flex mb-8 p-1 rounded-2xl aurora-glass">
          {(['login', 'signup'] as Mode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); setMessage(null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 ${mode === m ? 'aurora-glass-light' : 'opacity-50 hover:opacity-80'}`}
              style={{ color: mode === m ? '#00F5FF' : 'rgba(200, 240, 255, 0.7)' }}>
              {m === 'login' ? '登入' : '建立帳號'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'rgba(0, 245, 255, 0.6)' }}>顯示名稱</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="您的名稱" style={inputStyle} />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'rgba(0, 245, 255, 0.6)' }}>電子郵件</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" style={inputStyle} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest px-1" style={{ color: 'rgba(0, 245, 255, 0.6)' }}>密碼</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位字元" minLength={6} style={inputStyle} />
          </div>

          {message && (
            <div className={`flex items-start gap-3 p-4 rounded-2xl text-sm font-medium ${message.type === 'error' ? '' : ''}`}
              style={{
                background: message.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 245, 255, 0.08)',
                border: `1px solid ${message.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 245, 255, 0.25)'}`,
                color: message.type === 'error' ? 'rgb(248, 113, 113)' : '#00F5FF',
              }}>
              {message.type === 'error' ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle size={16} className="shrink-0 mt-0.5" />}
              {message.text}
            </div>
          )}

          <button type="submit" disabled={isLoading}
            className="w-full py-4 rounded-2xl font-bold tracking-tight transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2 mt-2 aurora-border-gradient"
            style={{ background: 'rgba(0, 245, 255, 0.12)', color: '#00F5FF' }}>
            {isLoading ? <><Loader2 size={16} className="animate-spin" />處理中...</> : mode === 'login' ? '登入系統' : '建立帳號'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Auth;
