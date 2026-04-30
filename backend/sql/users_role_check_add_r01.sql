BEGIN;

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (
  (role)::text = ANY (
    (
      ARRAY[
        'r01'::character varying,
        'r1'::character varying,
        'r2'::character varying,
        'r3'::character varying,
        'r4'::character varying,
        'r5'::character varying,
        'r6'::character varying,
        'r7'::character varying,
        'r8'::character varying,
        'r9'::character varying,
        'r10'::character varying,
        'r11'::character varying
      ]
    )::text[]
  )
);

COMMIT;
