-- ==============================================================================
-- MIGRATION: Fix Teacher & Principal Deletion Permissions for daily_entries
-- ==============================================================================
-- Run this in your Supabase SQL Editor if you want database-level hard deletion.
-- (The application also handles fallback soft-deletion/draft resetting automatically).

-- 1. Allow teachers to delete their own entries
DROP POLICY IF EXISTS "Teachers can delete own entries" ON public.daily_entries;
CREATE POLICY "Teachers can delete own entries" ON public.daily_entries FOR DELETE 
  USING (auth.uid() = teacher_id);

-- 2. Allow principals/admins to delete entries when necessary
DROP POLICY IF EXISTS "Principals can delete entries" ON public.daily_entries;
CREATE POLICY "Principals can delete entries" ON public.daily_entries FOR DELETE 
  USING (
    public.get_my_role() IN ('principal', 'vice_principal', 'admin', 'super_admin')
  );

-- 3. Ensure principal signatures cascade delete cleanly if linked
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'principal_signatures_entry_id_fkey'
  ) THEN
    ALTER TABLE public.principal_signatures DROP CONSTRAINT principal_signatures_entry_id_fkey;
    ALTER TABLE public.principal_signatures ADD CONSTRAINT principal_signatures_entry_id_fkey 
      FOREIGN KEY (entry_id) REFERENCES public.daily_entries(id) ON DELETE CASCADE;
  END IF;
END $$;
