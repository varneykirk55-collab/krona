ALTER TABLE owners ADD COLUMN outbound_consent_at timestamptz;
CREATE UNIQUE INDEX realtime_response_usage_once ON usage_events(conversation_id,(detail->>'provider_response_id')) WHERE kind='voice_ai_response';
CREATE INDEX browser_voice_owner_status ON browser_voice_sessions(owner_id,status);
