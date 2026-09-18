-- Verificación de aislamiento RLS (spec: auth/aislamiento)
-- Ejecutado contra el proyecto remoto whacwpjgizlxvnmckyli vía `supabase db query --linked`.
-- Resultado: OK en las 3 comprobaciones (2026-08-11).

-- 1. RLS habilitado en las tres tablas
-- SELECT c.relname, c.relrowsecurity FROM pg_class c ... → true en profiles/accounts/transactions

-- 2. Policies own-rows (todas con auth.uid() = user_id, INSERT con WITH CHECK idéntico)
-- Verificado vía pg_policies: 12 policies (4 por tabla).

-- 3. Rol anon NO puede insertar sin sesión (bloqueado por RLS):
--   SET ROLE anon;
--   INSERT INTO public.profiles (id, display_name) VALUES ('...', 'anon');
--   → ERROR 42501: new row violates row-level security policy for table "profiles"

-- Nota: `supabase db query` no acepta múltiples statements; las tres
-- comprobaciones se ejecutan por separado contra la base linkeada.
