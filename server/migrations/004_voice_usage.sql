CREATE UNIQUE INDEX voice_session_duration_once ON usage_events(conversation_id) WHERE kind='voice_session';
