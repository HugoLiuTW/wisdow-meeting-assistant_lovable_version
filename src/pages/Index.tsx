import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import MeetingAssistant from '../components/MeetingAssistant';
import { Loader2, BrainCircuit, ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const AUTO_AUTH_KEY = 'auto_auth_creds';

const generateCredentials = () => {
  const rand = () => Math.random().toString(36).slice(2);
  return {
    email: `u-${rand().slice(0, 8)}-${Date.now().toString(36)}@local.app`,
    password: rand() + rand() + rand() + rand(),
  };
};

const Index = () => {
  const { user, loading } = useAuth();
  const [entered, setEntered] = useState(false);
  const [autoLoginError, setAutoLoginError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleEnter = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setEntered(true);
    setAutoLoginError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setIsProcessing(false);
        return;
      }

      let creds = null;
      const stored = localStorage.getItem(AUTO_AUTH_KEY);
      if (stored) {
        try {
          creds = JSON.parse(stored);
        } catch {
          localStorage.removeItem(AUTO_AUTH_KEY);
        }
      }

      if (creds) {
        const { error } = await supabase.auth.signInWithPassword({
          email: creds.email,
          password: creds.password,
        });
        if (!error) {
          setIsProcessing(false);
          return;
        }
      }

      const newCreds = generateCredentials();
      const { error: signUpError } = await supabase.auth.signUp({
        email: newCreds.email,
        password: newCreds.password,
      });

      if (signUpError) {
        setAutoLoginError(signUpError.message || '自動登入失敗');
      } else {
        localStorage.setItem(AUTO_AUTH_KEY, JSON.stringify(newCreds));
      }
    } catch (err: any) {
      setAutoLoginError(err.message || '發生未知錯誤');
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading || (entered && !user && !autoLoginError)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  if (!entered) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center text-center max-w-md">
          <div className="p-5 rounded-3xl mb-6 bg-primary/10 shadow-ios-md">
            <BrainCircuit size={48} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">智會洞察</h1>
          <p className="text-base text-muted-foreground leading-relaxed mb-8">
            AI 驅動的會議深度分析系統<br />
            自動校正逐字稿、洞察核心議題、產出策略建議
          </p>
          <button
            onClick={handleEnter}
            disabled={isProcessing}
            className="group inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl font-semibold text-base tracking-tight transition-all active:scale-95 disabled:opacity-40 ios-btn-primary text-primary-foreground"
          >
            進入系統
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    );
  }

  if (autoLoginError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <AlertCircle size={40} className="text-destructive" />
          <p className="text-destructive font-medium">自動登入失敗</p>
          <p className="text-sm text-muted-foreground">{autoLoginError}</p>
          <button
            onClick={() => {
              setAutoLoginError(null);
              setEntered(false);
            }}
            className="mt-2 px-6 py-3 rounded-2xl text-sm font-semibold ios-btn-primary text-primary-foreground"
          >
            返回首頁重試
          </button>
        </div>
      </div>
    );
  }

  return <MeetingAssistant />;
};

export default Index;
