import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Auth from './Auth';
import MeetingAssistant from '../components/MeetingAssistant';
import { Loader2, BrainCircuit, ArrowRight } from 'lucide-react';

const Index = () => {
  const { user, loading } = useAuth();
  const [entered, setEntered] = useState(false);

  if (loading) {
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
            onClick={() => setEntered(true)}
            className="group inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl font-semibold text-base tracking-tight transition-all active:scale-95 ios-btn-primary text-primary-foreground"
          >
            進入系統
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <Auth />;
  return <MeetingAssistant />;
};

export default Index;
