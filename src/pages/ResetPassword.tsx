import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { BrainCircuit, Loader2, AlertCircle, CheckCircle, KeyRound } from 'lucide-react';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    // Supabase redirects with #access_token & type=recovery in the URL hash
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('access_token')) {
      setIsReady(true);
    } else {
      setMessage({ type: 'error', text: '無效的重設連結，請重新申請忘記密碼。' });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setMessage({ type: 'error', text: '兩次密碼輸入不一致，請確認後重試。' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setMessage({ type: 'success', text: '密碼已成功重設！請使用新密碼登入。' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '重設失敗，請稍後再試。' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 rounded-3xl mb-5 bg-primary/10 shadow-ios-md">
            <BrainCircuit size={36} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">智會洞察</h1>
          <p className="text-sm mt-1.5 text-muted-foreground">設定新密碼</p>
        </div>

        <div className="ios-glass rounded-3xl p-6 shadow-ios-md">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-primary/10">
              <KeyRound size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">重設密碼</p>
              <p className="text-[13px] text-muted-foreground">請輸入您的新密碼</p>
            </div>
          </div>

          {!done ? (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
                  新密碼
                </label>
                <input
                  type="password"
                  required
                  disabled={!isReady}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="至少 6 位字元"
                  minLength={6}
                  className="w-full p-3.5 rounded-xl text-sm ios-input text-foreground placeholder:text-muted-foreground/40 disabled:opacity-40"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
                  確認新密碼
                </label>
                <input
                  type="password"
                  required
                  disabled={!isReady}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="再次輸入新密碼"
                  minLength={6}
                  className="w-full p-3.5 rounded-xl text-sm ios-input text-foreground placeholder:text-muted-foreground/40 disabled:opacity-40"
                />
              </div>

              {message && (
                <div className={`flex items-start gap-2.5 p-3.5 rounded-xl text-sm font-medium border ${message.type === 'error' ? 'bg-destructive/8 border-destructive/20 text-destructive' : 'bg-primary/8 border-primary/20 text-primary'}`}>
                  {message.type === 'error'
                    ? <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    : <CheckCircle size={15} className="shrink-0 mt-0.5" />}
                  {message.text}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !isReady}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm tracking-tight transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2 mt-1 ios-btn-primary text-primary-foreground"
              >
                {isLoading ? <><Loader2 size={15} className="animate-spin" />處理中...</> : '確認更新密碼'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {message && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl text-sm font-medium border bg-primary/8 border-primary/20 text-primary">
                  <CheckCircle size={15} className="shrink-0 mt-0.5" />
                  {message.text}
                </div>
              )}
              <button
                onClick={() => navigate('/')}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm tracking-tight transition-all active:scale-95 ios-btn-primary text-primary-foreground"
              >
                前往登入頁面
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
