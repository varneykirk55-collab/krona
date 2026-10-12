CREATE TABLE project_conversations (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,conversation_id)
);
CREATE TABLE task_conversations (
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
 PRIMARY KEY(task_id,conversation_id)
);
CREATE INDEX project_conversation_owner ON project_conversations(owner_id,project_id);
CREATE INDEX task_conversation_owner ON task_conversations(owner_id,task_id);
ALTER TABLE project_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON project_conversations,task_conversations FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON project_conversations,task_conversations FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON project_conversations,task_conversations FROM authenticated; END IF;
END $$;
ALTER TABLE browser_voice_sessions ADD COLUMN max_seconds integer NOT NULL DEFAULT 600;
ALTER TABLE browser_voice_sessions ADD COLUMN last_error text;
