
-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Meeting records table
CREATE TABLE public.meeting_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '未命名會議分析',
  raw_transcript TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{"subject":"","keywords":"","speakers":"","terminology":"","length":""}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own records"
  ON public.meeting_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own records"
  ON public.meeting_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own records"
  ON public.meeting_records FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own records"
  ON public.meeting_records FOR DELETE
  USING (auth.uid() = user_id);

-- Transcript versions (each correction run creates a new version)
CREATE TABLE public.transcript_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID NOT NULL REFERENCES public.meeting_records(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  corrected_transcript TEXT NOT NULL,
  correction_log TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.transcript_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transcript versions"
  ON public.transcript_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_records
      WHERE meeting_records.id = transcript_versions.record_id
        AND meeting_records.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own transcript versions"
  ON public.transcript_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_records
      WHERE meeting_records.id = transcript_versions.record_id
        AND meeting_records.user_id = auth.uid()
    )
  );

-- Module analysis versions (each module run creates a new version)
CREATE TABLE public.module_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID NOT NULL REFERENCES public.meeting_records(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.module_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own module versions"
  ON public.module_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_records
      WHERE meeting_records.id = module_versions.record_id
        AND meeting_records.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own module versions"
  ON public.module_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_records
      WHERE meeting_records.id = module_versions.record_id
        AND meeting_records.user_id = auth.uid()
    )
  );

-- Chat messages (linked to a specific module version)
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_version_id UUID NOT NULL REFERENCES public.module_versions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat messages"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.module_versions mv
      JOIN public.meeting_records mr ON mr.id = mv.record_id
      WHERE mv.id = chat_messages.module_version_id
        AND mr.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own chat messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.module_versions mv
      JOIN public.meeting_records mr ON mr.id = mv.record_id
      WHERE mv.id = chat_messages.module_version_id
        AND mr.user_id = auth.uid()
    )
  );

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meeting_records_updated_at
  BEFORE UPDATE ON public.meeting_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
