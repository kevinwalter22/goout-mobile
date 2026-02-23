-- Migration 079: Add llm_text_moderation feature flag
--
-- Controls whether borderline text (severity 55–75) is escalated to
-- an LLM edge function for secondary review. Default: OFF.

INSERT INTO public.feature_flags (flag_name, is_enabled)
VALUES ('llm_text_moderation', false)
ON CONFLICT (flag_name) DO NOTHING;
