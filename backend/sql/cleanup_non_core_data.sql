BEGIN;

-- Safe data-only cleanup for the TaskTracker PostgreSQL database.
-- Preserves both schema and data for:
--   public.users
--   public.roles
--   public.departments
--   public.permissions
--   public.role_permissions
--
-- Clears all other base tables in the application-owned schemas:
--   public
--   design
--
-- Important safeguard:
-- If any preserved core table currently contains foreign-key values that point to
-- a non-core table, this script aborts before truncation because a full cleanup
-- would otherwise require changing preserved data.

DO $$
DECLARE
  missing_core_tables text;
BEGIN
  SELECT string_agg(required_table, ', ' ORDER BY required_table)
  INTO missing_core_tables
  FROM (
    SELECT required_table
    FROM unnest(ARRAY[
      'public.users',
      'public.roles',
      'public.departments',
      'public.permissions',
      'public.role_permissions'
    ]) AS required_table
    WHERE to_regclass(required_table) IS NULL
  ) missing;

  IF missing_core_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'Cleanup aborted. Missing required core table(s): %',
      missing_core_tables;
  END IF;
END $$;

CREATE TEMP TABLE __keep_users ON COMMIT DROP AS
SELECT *
FROM public.users;

CREATE TEMP TABLE __keep_roles ON COMMIT DROP AS
SELECT *
FROM public.roles;

CREATE TEMP TABLE __keep_departments ON COMMIT DROP AS
SELECT *
FROM public.departments;

CREATE TEMP TABLE __keep_permissions ON COMMIT DROP AS
SELECT *
FROM public.permissions;

CREATE TEMP TABLE __keep_role_permissions ON COMMIT DROP AS
SELECT *
FROM public.role_permissions;

DO $$
DECLARE
  blocker record;
  has_rows boolean;
  blocker_list text[] := ARRAY[]::text[];
BEGIN
  FOR blocker IN
    SELECT
      src_ns.nspname AS source_schema,
      src.relname AS source_table,
      src_att.attname AS source_column,
      ref_ns.nspname AS target_schema,
      ref.relname AS target_table
    FROM pg_constraint con
    JOIN pg_class src
      ON src.oid = con.conrelid
    JOIN pg_namespace src_ns
      ON src_ns.oid = src.relnamespace
    JOIN pg_class ref
      ON ref.oid = con.confrelid
    JOIN pg_namespace ref_ns
      ON ref_ns.oid = ref.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS fk_cols(attnum, ord)
      ON TRUE
    JOIN pg_attribute src_att
      ON src_att.attrelid = con.conrelid
     AND src_att.attnum = fk_cols.attnum
    WHERE con.contype = 'f'
      AND src_ns.nspname = 'public'
      AND src.relname IN ('users', 'roles', 'departments', 'permissions', 'role_permissions')
      AND NOT (
        ref_ns.nspname = 'public'
        AND ref.relname IN ('users', 'roles', 'departments', 'permissions', 'role_permissions')
      )
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I IS NOT NULL)',
      blocker.source_schema,
      blocker.source_table,
      blocker.source_column
    )
    INTO has_rows;

    IF has_rows THEN
      blocker_list := blocker_list || format(
        '%I.%I.%I -> %I.%I',
        blocker.source_schema,
        blocker.source_table,
        blocker.source_column,
        blocker.target_schema,
        blocker.target_table
      );
    END IF;
  END LOOP;

  IF array_length(blocker_list, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Cleanup aborted. Preserved core data still references non-core tables: %',
      array_to_string(blocker_list, ', ');
  END IF;
END $$;

DO $$
DECLARE
  truncate_targets text;
BEGIN
  SELECT string_agg(format('%I.%I', table_schema, table_name), ', ' ORDER BY table_schema, table_name)
  INTO truncate_targets
  FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_schema IN ('public', 'design')
    AND NOT (
      table_schema = 'public'
      AND table_name IN ('users', 'roles', 'departments', 'permissions', 'role_permissions')
    );

  IF truncate_targets IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || truncate_targets || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;

INSERT INTO public.roles
SELECT *
FROM __keep_roles;

INSERT INTO public.departments
SELECT *
FROM __keep_departments;

INSERT INTO public.users
SELECT *
FROM __keep_users;

INSERT INTO public.permissions
SELECT *
FROM __keep_permissions;

INSERT INTO public.role_permissions
SELECT *
FROM __keep_role_permissions;

COMMIT;
