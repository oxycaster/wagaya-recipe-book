CREATE SCHEMA IF NOT EXISTS recipe_cloud;
SET search_path TO recipe_cloud;
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text NOT NULL, deleted_at timestamptz, deletion_completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
 user_id text PRIMARY KEY REFERENCES users(id), balance integer NOT NULL DEFAULT 0,
 reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);
CREATE TABLE IF NOT EXISTS books (
 id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
 book_id uuid REFERENCES books(id) ON DELETE CASCADE, user_id text REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(book_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON members(book_id) WHERE role='owner';
CREATE TABLE IF NOT EXISTS invites (
 id uuid PRIMARY KEY, book_id uuid REFERENCES books(id) ON DELETE CASCADE,
 token_hash text UNIQUE NOT NULL, email text NOT NULL, role text NOT NULL CHECK(role IN ('editor','viewer')),
 expires_at timestamptz NOT NULL, accepted_by text REFERENCES users(id), revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS archives (
 id uuid PRIMARY KEY, user_id text REFERENCES users(id), book_id uuid REFERENCES books(id) ON DELETE CASCADE,
 object_key text UNIQUE NOT NULL, image_key text UNIQUE, image_content_type text,
 source_url text NOT NULL, sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,book_id,sha256)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, user_id text REFERENCES users(id), book_id uuid REFERENCES books(id) ON DELETE CASCADE,
 archive_id uuid REFERENCES archives(id) ON DELETE CASCADE, request_key uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','processing','succeeded','needs_review','failed')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, error_code text,
 model text, usage jsonb, quote_id uuid, reserved_credits integer NOT NULL DEFAULT 1,
 consumed_credits integer NOT NULL DEFAULT 0, phase text NOT NULL DEFAULT 'queued',
 processed_chunks integer NOT NULL DEFAULT 0, total_chunks integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);
CREATE TABLE IF NOT EXISTS import_quotes (
 id uuid PRIMARY KEY, user_id text REFERENCES users(id), book_id uuid REFERENCES books(id) ON DELETE CASCADE,
 archive_id uuid REFERENCES archives(id) ON DELETE CASCADE, estimated_input_tokens integer NOT NULL,
 maximum_credits integer NOT NULL CHECK(maximum_credits>0), expires_at timestamptz NOT NULL,
 used_by uuid UNIQUE REFERENCES jobs(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_model_calls (
 id uuid PRIMARY KEY, job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
 phase text NOT NULL CHECK(phase IN ('scan','extract')), chunk_index integer NOT NULL,
 chunk_hash text NOT NULL, model text NOT NULL, status text NOT NULL,
 result jsonb, usage jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,phase,chunk_index,chunk_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_import ON jobs(archive_id) WHERE status IN ('queued','processing','succeeded');
CREATE TABLE IF NOT EXISTS recipes (
 id uuid PRIMARY KEY, book_id uuid REFERENCES books(id) ON DELETE CASCADE,
 archive_id uuid UNIQUE REFERENCES archives(id) ON DELETE SET NULL, card jsonb NOT NULL,
 image_key text UNIQUE, image_content_type text,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
 book_id uuid REFERENCES books(id) ON DELETE CASCADE, day date NOT NULL,
 items jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1, PRIMARY KEY(book_id,day)
);
CREATE TABLE IF NOT EXISTS purchases (
 store text NOT NULL, environment text NOT NULL, transaction_id text NOT NULL,
 user_id text REFERENCES users(id), product_id text NOT NULL, credits integer NOT NULL CHECK(credits>0),
 granted boolean NOT NULL DEFAULT false, refunded boolean NOT NULL DEFAULT false,
 refund_at bigint NOT NULL DEFAULT 0, PRIMARY KEY(store,environment,transaction_id)
);
CREATE TABLE IF NOT EXISTS ledger (
 id uuid PRIMARY KEY, user_id text REFERENCES users(id), delta integer NOT NULL,
 reason text NOT NULL, reference text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_events (
 id text PRIMARY KEY, type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,lease_until,created_at);
CREATE INDEX IF NOT EXISTS member_users ON members(user_id);
CREATE INDEX IF NOT EXISTS archives_user_book_created ON archives(user_id,book_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS jobs_archive_created ON jobs(archive_id,created_at DESC);
REVOKE ALL ON SCHEMA recipe_cloud FROM PUBLIC;

-- Safe when upgrading a database created by an earlier app build.
ALTER TABLE archives ADD COLUMN IF NOT EXISTS image_key text UNIQUE;
ALTER TABLE archives ADD COLUMN IF NOT EXISTS image_content_type text;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_key text UNIQUE;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_content_type text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reserved_credits integer NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS consumed_credits integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'queued';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS processed_chunks integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS total_chunks integer NOT NULL DEFAULT 0;
