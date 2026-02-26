import { useAuth } from '@/hooks/useAuth';
import Auth from './Auth';
import MeetingAssistant from '../components/MeetingAssistant';
import { Loader2 } from 'lucide-react';

const Index = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  if (!user) return <Auth />;
  return <MeetingAssistant />;
};

export default Index;
