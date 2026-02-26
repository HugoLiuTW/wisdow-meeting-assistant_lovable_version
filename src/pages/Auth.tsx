import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BrainCircuit, Loader2 } from 'lucide-react';

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
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setMessage({ type: 'success', text: '帳號建立成功！請至信箱確認驗證信件後登入。' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      const msg = err.message || '操作失敗，請稍後再試';
      if (msg.includes('Invalid login credentials')) setMessage({ type: 'error', text: '帳號或密碼錯誤' });
      else if (msg.includes('Email not confirmed')) setMessage({ type: 'error', text: '請先驗證您的電子郵件後再登入' });
      else if (msg.includes('User already registered')) setMessage({ type: 'error', text: '此電子郵件已被使用' });
      else setMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <div className="p-4 bg-muted rounded-3xl mb-5">
            <BrainCircuit size={36} className="text-foreground" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tighter">智會洞察</h1>
          <p className="text-muted-foreground text-sm mt-2">AI 驅動的會議深度分析系統</p>
        </div>

        <div className="bg-muted p-1 rounded-2xl flex mb-8">
          {(['login', 'signup'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setMessage(null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 ${mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {m === 'login' ? '登入' : '建立帳號'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">顯示名稱</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="您的名稱"
                className="w-full p-4 bg-background border border-border rounded-2xl outline-none focus:ring-2 focus:ring-ring/30 text-sm transition-all"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">電子郵件</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full p-4 bg-background border border-border rounded-2xl outline-none focus:ring-2 focus:ring-ring/30 text-sm transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">密碼</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位字元"
              minLength={6}
              className="w-full p-4 bg-background border border-border rounded-2xl outline-none focus:ring-2 focus:ring-ring/30 text-sm transition-all"
            />
          </div>

          {message && (
            <div className={`p-4 rounded-2xl text-sm font-medium ${message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-700 dark:text-green-400'}`}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold tracking-tight transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? <><Loader2 size={18} className="animate-spin" />處理中...</> : mode === 'login' ? '登入系統' : '建立帳號'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Auth;
