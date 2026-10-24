-- The Gemini categoriser is gone: an instance set to it has no AI provider.
update app_settings
   set budget_ai_provider = null, budget_ai_model = null
 where budget_ai_provider = 'gemini';
