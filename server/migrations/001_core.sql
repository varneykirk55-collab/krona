CREATE TABLE owners (
 id uuid PRIMARY KEY, singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
 email text NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL,
 phone_pin_hash text, phone_verified boolean NOT NULL DEFAULT false,
 settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE system_meta (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 name text NOT NULL, description text NOT NULL DEFAULT '', objectives jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
 progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
 milestones jsonb NOT NULL DEFAULT '[]', blockers jsonb NOT NULL DEFAULT '[]', decisions jsonb NOT NULL DEFAULT '[]',
 next_action text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('text','phone','browser')), status text NOT NULL DEFAULT 'active',
 summary text NOT NULL DEFAULT '', summary_confidence text NOT NULL DEFAULT 'interpretation',
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversation_messages (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL DEFAULT '', project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
 priority text NOT NULL CHECK (priority IN ('urgent','high','normal','low')),
 status text NOT NULL CHECK (status IN ('not_started','in_progress','blocked','waiting','completed','canceled')),
 due_at timestamptz, notes text NOT NULL DEFAULT '', recurrence jsonb,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 next_instance_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_dependencies (
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 depends_on uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 PRIMARY KEY (task_id, depends_on), CHECK (task_id <> depends_on)
);
CREATE TABLE memories (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 content text NOT NULL, category text NOT NULL CHECK (category IN ('preferences','knowledge','projects','routines')),
 confidence text NOT NULL CHECK (confidence IN ('confirmed','user_provided','interpretation','unverified','outdated','conflicted')),
 subject text NOT NULL DEFAULT '', project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
 sensitive boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'owner',
 canonical_hash text NOT NULL, conflict_group uuid,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 embedding double precision[], embedding_model text,
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content || ' ' || subject)) STORED,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (owner_id, canonical_hash, category)
);
CREATE TABLE schedules (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 title text NOT NULL, purpose text NOT NULL DEFAULT '',
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL, project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
 recurrence text NOT NULL CHECK (recurrence IN ('once','daily','weekdays','weekly')),
 timezone text NOT NULL, local_time text NOT NULL, day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
 next_run_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scheduled_jobs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
 schedule_version integer NOT NULL, occurrence_at timestamptz NOT NULL, run_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','dispatching','completed','canceled','failed','blocked','unknown')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (schedule_id, schedule_version, occurrence_at)
);
CREATE TABLE calls (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 twilio_sid text UNIQUE, job_id uuid UNIQUE REFERENCES scheduled_jobs(id) ON DELETE SET NULL,
 schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
 status text NOT NULL DEFAULT 'reserved', outcome text, duration_seconds integer,
 reserved_cost_usd numeric, estimated_cost_usd numeric, started_at timestamptz, ended_at timestamptz,
 authenticated_at timestamptz, last_status_sequence integer NOT NULL DEFAULT -1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE phone_auth_attempts (
 call_sid text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, passed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE voice_tokens (
 token_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE, call_sid text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE webhook_events (
 event_key text PRIMARY KEY, call_id uuid REFERENCES calls(id) ON DELETE CASCADE,
 owner_id uuid REFERENCES owners(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE actions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 kind text NOT NULL, risk text NOT NULL CHECK (risk IN ('low','confirmation','high')),
 title text NOT NULL, payload jsonb NOT NULL, scope_hash text NOT NULL,
 status text NOT NULL DEFAULT 'proposed', approved_scope_hash text, approved_at timestamptz, expires_at timestamptz NOT NULL,
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_executions (
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 call_id text NOT NULL, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (conversation_id, call_id)
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 action text NOT NULL, entity_type text, entity_id uuid, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usage_events (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 kind text NOT NULL, call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
 seconds integer NOT NULL DEFAULT 0, estimated_cost_usd numeric, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE browser_voice_sessions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 provider_call_id text, status text NOT NULL DEFAULT 'starting', reserved_cost_usd numeric,
 created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE INDEX task_owner_status ON tasks(owner_id, status, due_at);
CREATE INDEX project_owner_status ON projects(owner_id,status);
CREATE INDEX memory_search ON memories USING GIN(search_vector);
CREATE INDEX memory_subject ON memories(owner_id,subject);
CREATE INDEX memory_owner_category ON memories(owner_id,category,updated_at DESC);
CREATE INDEX job_ready ON scheduled_jobs(status,run_at);
CREATE INDEX call_owner_date ON calls(owner_id,created_at);
CREATE INDEX conversation_owner_date ON conversations(owner_id,started_at DESC);
CREATE INDEX usage_owner_date ON usage_events(owner_id,created_at);
CREATE INDEX audit_owner_date ON audit_logs(owner_id,created_at DESC);
CREATE INDEX session_expiry ON sessions(expires_at);

-- Browser clients NEVER connect directly to PostgreSQL. RLS denies untrusted roles;
-- the private backend uses a dedicated trusted table-owning role and owner-scoped queries.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['owners','sessions','projects','conversations','conversation_messages','tasks','task_dependencies','memories','schedules','scheduled_jobs','calls','phone_auth_attempts','voice_tokens','webhook_events','actions','tool_executions','audit_logs','usage_events','browser_voice_sessions','system_meta'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tab);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', tab); END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', tab); END IF;
 END LOOP;
END $$;
