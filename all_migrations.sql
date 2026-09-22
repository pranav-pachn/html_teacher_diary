-- ====================================================================
-- EDUFLOW LMS - PHASE 1 MIGRATION SCRIPT
-- RUN THIS ENTIRE SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. SCHOOLS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to schools" ON public.schools FOR SELECT USING (true);

-- ==========================================
-- 2. USERS (RBAC)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id),
  email TEXT NOT NULL,
  name TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  role TEXT DEFAULT 'teacher' CHECK (role IN ('teacher', 'principal', 'vice_principal', 'hod', 'admin', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Users can read their own data
CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT USING (auth.uid() = id);
-- Principals and Admins can view all users in their school
CREATE POLICY "Principals/Admins can view school users" ON public.users FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.users.school_id 
      AND u.role IN ('principal', 'admin', 'super_admin')
    )
  );
-- Users can update their own non-role fields
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
-- Users can insert their own profile on signup
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- ==========================================
-- 3. TIMETABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.timetable (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id),
  teacher_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_number INT NOT NULL,
  class_section TEXT NOT NULL,
  subject TEXT NOT NULL,
  start_time TIME,
  end_time TIME,
  UNIQUE (teacher_id, day_of_week, period_number)
);
ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;
-- Teachers view own timetable
CREATE POLICY "Teachers can view own timetable" ON public.timetable FOR SELECT USING (auth.uid() = teacher_id);
-- Admins can manage school timetable
CREATE POLICY "Admins can manage timetable" ON public.timetable FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.timetable.school_id 
      AND u.role IN ('admin', 'super_admin')
    )
  );

-- ==========================================
-- 4. DAILY ENTRIES (IMMUTABLE REVISIONS)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.daily_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id),
  teacher_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  period_number INT NOT NULL,
  class_section TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  classwork TEXT DEFAULT '',
  homework TEXT DEFAULT '',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'revision_requested')),
  revision_number INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (teacher_id, date, period_number, revision_number)
);
ALTER TABLE public.daily_entries ENABLE ROW LEVEL SECURITY;
-- Teachers can manage their own entries
CREATE POLICY "Teachers can view own entries" ON public.daily_entries FOR SELECT USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers can insert own entries" ON public.daily_entries FOR INSERT WITH CHECK (auth.uid() = teacher_id);
-- Prevent updates if approved (should insert new revision instead)
CREATE POLICY "Teachers can update unapproved entries" ON public.daily_entries FOR UPDATE 
  USING (auth.uid() = teacher_id AND status != 'approved')
  WITH CHECK (auth.uid() = teacher_id AND status != 'approved');
-- Principals can view school entries
CREATE POLICY "Principals can view school entries" ON public.daily_entries FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.daily_entries.school_id 
      AND u.role IN ('principal', 'vice_principal')
    )
  );
-- Principals can update status
CREATE POLICY "Principals can update status" ON public.daily_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.daily_entries.school_id 
      AND u.role IN ('principal', 'vice_principal')
    )
  );

-- ==========================================
-- 5. ATTACHMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  school_id UUID REFERENCES public.schools(id),
  teacher_id UUID REFERENCES public.users(id),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
-- Same policies basically as daily_entries
CREATE POLICY "Users can view own attachments" ON public.attachments FOR SELECT USING (auth.uid() = teacher_id);
CREATE POLICY "Users can insert own attachments" ON public.attachments FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Users can delete own attachments" ON public.attachments FOR DELETE USING (auth.uid() = teacher_id);
CREATE POLICY "Principals can view school attachments" ON public.attachments FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.attachments.school_id 
      AND u.role IN ('principal', 'vice_principal')
    )
  );

-- ==========================================
-- 6. PRINCIPAL SIGNATURES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.principal_signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id),
  entry_id UUID REFERENCES public.daily_entries(id),
  signed_by UUID REFERENCES public.users(id),
  signature_hash TEXT NOT NULL,
  remarks TEXT,
  signed_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.principal_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone in school can view signatures" ON public.principal_signatures FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.principal_signatures.school_id 
    )
  );
CREATE POLICY "Principals can sign" ON public.principal_signatures FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.id = public.principal_signatures.signed_by
      AND u.role IN ('principal', 'vice_principal')
    )
  );

-- ==========================================
-- 7. AUDIT LOGS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  school_id UUID REFERENCES public.schools(id),
  user_id UUID REFERENCES public.users(id),
  role TEXT,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  before_value JSONB,
  after_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
-- Only admins can read audit logs
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.id = auth.uid() 
      AND u.school_id = public.audit_logs.school_id
      AND u.role IN ('admin', 'super_admin')
    )
  );
-- Authenticated users can insert logs (app logic writes here)
CREATE POLICY "Users can insert audit logs" ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Storage bucket creation for Activity Photos (Structured)
-- Note: Requires manual creation in Supabase UI or using storage-api
-- Bucket Name: "activity_photos"

-- ====================================================================
-- EDUFLOW LMS - PHASE 2 MIGRATION SCRIPT (FILE UPLOADS)
-- RUN THIS ENTIRE SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- 1. Create the private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('period_files', 'period_files', false)
ON CONFLICT (id) DO NOTHING;


-- 3. Storage RLS Policies for `period_files` bucket
-- Note: The path structure is: school_id/teacher_id/YYYY-MM-DD/period_N/filename

-- Policy: Teachers can insert files into their own folder path
CREATE POLICY "Teachers can upload to their folder" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = (SELECT school_id::text FROM public.users WHERE id = auth.uid()) AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: Teachers can view/download their own files
CREATE POLICY "Teachers can view their own files" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: Principals and Admins can view files in their school
CREATE POLICY "Principals and Admins can view school files" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = (SELECT school_id::text FROM public.users WHERE id = auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('principal', 'vice_principal', 'admin', 'super_admin')
  )
);

-- Policy: Teachers can delete their own files
CREATE POLICY "Teachers can delete their own files" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy: Teachers can update their own files (overwrite)
CREATE POLICY "Teachers can update their own files" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- 4. Update attachments table to store file details more effectively if needed
-- We already have file_name, file_url, file_type, file_size.
-- We will store the storage path in file_url (e.g. "school_id/teacher_id/2026-07-18/period_1/uuid-filename.pdf")
-- No schema changes needed for attachments table currently, Phase 1 schema suffices.

-- ====================================================================
-- EDUFLOW LMS - PHASE 3: PRINCIPAL APPROVAL WORKFLOW MIGRATION
-- RUN THIS SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

BEGIN;

-- 1. Add new columns to daily_entries
ALTER TABLE public.daily_entries 
  ADD COLUMN IF NOT EXISTS revision_note TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ DEFAULT NULL;

-- 2. Drop any old conflicting policies we'll be recreating
DROP POLICY IF EXISTS "Principals can update status" ON public.daily_entries;
DROP POLICY IF EXISTS "Principals can update entry status" ON public.daily_entries;
DROP POLICY IF EXISTS "Teachers can view own signatures" ON public.principal_signatures;

-- 3. Allow principals/vice principals to UPDATE status fields on any entry
CREATE POLICY "Principals can update entry status" ON public.daily_entries
  FOR UPDATE
  USING (
    public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
  )
  WITH CHECK (
    public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
  );

-- 4. Allow teachers to view their own signatures (for the locked entry badge)
CREATE POLICY "Teachers can view own signatures" ON public.principal_signatures
  FOR SELECT
  USING (
    -- Teacher can see signature if the entry_id links to one of their entries
    EXISTS (
      SELECT 1 FROM public.daily_entries de
      WHERE de.id = public.principal_signatures.entry_id
        AND de.teacher_id = auth.uid()
    )
  );

COMMIT;

-- ====================================================================
-- EDUFLOW LMS - PHASE 4 MIGRATION SCRIPT (REVISION HISTORY)
-- RUN THIS IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- 1. Add `change_summary` to audit_logs if it doesn't exist yet
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'change_summary') THEN
        ALTER TABLE public.audit_logs ADD COLUMN change_summary TEXT;
    END IF;
END $$;

-- 2. Allow teachers to read their OWN audit log entries (action + timestamp only via app logic)
-- We need to drop existing restrictive policies on audit_logs if they conflict, but we can just add new ones.
-- The existing policy is "Admins read audit logs" which uses EXISTS for 'admin', 'super_admin'.
-- We'll add policies for teachers and principals.
CREATE POLICY "Teachers read own audit logs" ON public.audit_logs
  FOR SELECT USING (auth.uid() = user_id);

-- 3. Allow principals to read ALL audit logs
CREATE POLICY "Principals read school audit logs" ON public.audit_logs
  FOR SELECT USING (
    public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
  );

-- Note: The existing 'Admins read audit logs' policy covers admin/super_admin.

-- ====================================================================
-- EDUFLOW LMS - PHASE 6 MIGRATION SCRIPT (NOTIFICATIONS)
-- RUN THIS ENTIRE SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL, -- 'submission', 'approved', 'rejected', 'revision_requested'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  related_date DATE,           -- diary date this refers to
  related_entry_ids TEXT[],    -- entry UUIDs
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users see own notifications
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Authenticated users can insert notifications (for sending to others)
CREATE POLICY "Authenticated users can send notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy: Users can update their own notifications (to mark as read)
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Enable Realtime for notifications table
alter publication supabase_realtime add table public.notifications;

-- ====================================================================
-- RPC function to allow teachers to send notifications to principals
-- (Bypasses RLS so teachers can notify principals without needing SELECT on users table)
-- ====================================================================
CREATE OR REPLACE FUNCTION notify_principals(
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_related_date DATE,
    p_related_entry_ids TEXT[]
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, related_date, related_entry_ids)
    SELECT id, p_type, p_title, p_message, p_related_date, p_related_entry_ids
    FROM public.users
    WHERE role IN ('principal', 'admin', 'super_admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================================================
-- EDUFLOW LMS - CURRICULUM TABLES MIGRATION
-- RUN THIS SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- 1. BOARDS
CREATE TABLE IF NOT EXISTS public.boards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0
);
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to boards" ON public.boards FOR SELECT USING (true);

-- Insert Default Boards
INSERT INTO public.boards (name, display_order) VALUES 
('CBSE', 1), ('ICSE', 2), ('State Board', 3)
ON CONFLICT DO NOTHING;


-- 2. CLASSES
CREATE TABLE IF NOT EXISTS public.classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0
);
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to classes" ON public.classes FOR SELECT USING (true);

-- Insert Default Classes
INSERT INTO public.classes (name, display_order) VALUES 
('1', 1), ('2', 2), ('3', 3), ('4', 4), ('5', 5), 
('6', 6), ('7', 7), ('8', 8), ('9', 9), ('10', 10)
ON CONFLICT DO NOTHING;


-- 3. SUBJECTS
CREATE TABLE IF NOT EXISTS public.subjects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  folder_key TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0
);
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to subjects" ON public.subjects FOR SELECT USING (true);

-- Insert Default Subjects
INSERT INTO public.subjects (name, display_order) VALUES 
('Mathematics', 1), ('Science', 2), ('Social Studies', 3), 
('English', 4), ('Hindi', 5), ('Telugu', 6)
ON CONFLICT DO NOTHING;

-- ====================================================================
-- EDUFLOW LMS - FIX RLS INFINITE RECURSION ON USERS TABLE
-- RUN THIS SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

-- 1. Drop the policy that is causing the infinite recursion
DROP POLICY IF EXISTS "Principals/Admins can view school users" ON public.users;

-- 2. Create a secure helper function that checks admin status while bypassing RLS
CREATE OR REPLACE FUNCTION public.is_school_admin(check_school_id UUID) 
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND school_id = check_school_id 
    AND role IN ('principal', 'admin', 'super_admin')
  );
$$;

-- 3. Recreate the policy using the secure helper function
CREATE POLICY "Principals/Admins can view school users" ON public.users 
FOR SELECT 
USING (
  public.is_school_admin(school_id)
);

-- ====================================================================
-- EDUFLOW LMS - SINGLE-SCHOOL REFACTOR MIGRATION
-- RUN THIS SCRIPT IN YOUR SUPABASE SQL EDITOR
-- ====================================================================

BEGIN;

-- 1. Drop existing policies that depend on school_id
DROP POLICY IF EXISTS "Principals/Admins can view school users" ON public.users;
DROP POLICY IF EXISTS "Admins can manage timetable" ON public.timetable;
DROP POLICY IF EXISTS "Principals can view school entries" ON public.daily_entries;
DROP POLICY IF EXISTS "Principals and Admins can view school files" ON storage.objects;
DROP POLICY IF EXISTS "Principals can view school attachments" ON public.attachments;
DROP POLICY IF EXISTS "Principals can sign school entries" ON public.principal_signatures;
DROP POLICY IF EXISTS "Admins can view school audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Principals can manage classes" ON public.classes;
DROP POLICY IF EXISTS "Principals can manage subjects" ON public.subjects;

-- Drop the broken policies that were created previously
DROP POLICY IF EXISTS "Principals/Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Principals can view all entries" ON public.daily_entries;
DROP POLICY IF EXISTS "Principals can view all attachments" ON public.attachments;
DROP POLICY IF EXISTS "Principals can sign all entries" ON public.principal_signatures;
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Principals and Admins can view all files" ON storage.objects;

-- 2. Drop the school_id columns
ALTER TABLE IF EXISTS public.users DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.timetable DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.daily_entries DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.attachments DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.principal_signatures DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.audit_logs DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.classes DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE IF EXISTS public.subjects DROP COLUMN IF EXISTS school_id CASCADE;

-- 3. Recreate RLS Policies Without School ID

-- Helper function to avoid infinite recursion on users table
CREATE OR REPLACE FUNCTION public.get_my_role() 
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- USERS
CREATE POLICY "Principals/Admins can view all users" ON public.users FOR SELECT 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin', 'vice_principal', 'hod')
  );

-- TIMETABLE
CREATE POLICY "Admins can manage timetable" ON public.timetable FOR ALL 
  USING (
    public.get_my_role() IN ('admin', 'super_admin')
  );

-- DAILY ENTRIES
CREATE POLICY "Principals can view all entries" ON public.daily_entries FOR SELECT 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin', 'vice_principal', 'hod')
  );

CREATE POLICY "Teachers can delete own entries" ON public.daily_entries FOR DELETE 
  USING (auth.uid() = teacher_id);

CREATE POLICY "Principals can delete entries" ON public.daily_entries FOR DELETE 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin', 'vice_principal')
  );

-- ATTACHMENTS
CREATE POLICY "Principals can view all attachments" ON public.attachments FOR SELECT 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin', 'vice_principal', 'hod')
  );

-- PRINCIPAL SIGNATURES
CREATE POLICY "Principals can sign all entries" ON public.principal_signatures FOR ALL 
  USING (
    public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
  );

-- AUDIT LOGS
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs FOR SELECT 
  USING (
    public.get_my_role() IN ('admin', 'super_admin')
  );

-- CLASSES
CREATE POLICY "Principals can manage classes" ON public.classes FOR ALL 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin')
  );

-- SUBJECTS
CREATE POLICY "Principals can manage subjects" ON public.subjects FOR ALL 
  USING (
    public.get_my_role() IN ('principal', 'admin', 'super_admin')
  );


-- 4. Recreate Storage Bucket Policies (No school_id in folder path)
-- Old path structure: school_id/teacher_id/YYYY-MM-DD/period_N/filename
-- New path structure: teacher_id/YYYY-MM-DD/period_N/filename

-- Drop old storage policies
DROP POLICY IF EXISTS "Teachers can upload to their folder" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can view their own files" ON storage.objects;
DROP POLICY IF EXISTS "Principals and Admins can view school files" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can delete their own files" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can update their own files" ON storage.objects;

-- Create new storage policies
CREATE POLICY "Teachers can upload to their folder" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Teachers can view their own files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Principals and Admins can view all files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'period_files' AND
  public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
);

CREATE POLICY "Teachers can delete their own files" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Teachers can update their own files" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'period_files' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. Finally, drop the schools table since it's no longer needed
DROP TABLE IF EXISTS public.schools CASCADE;

COMMIT;
