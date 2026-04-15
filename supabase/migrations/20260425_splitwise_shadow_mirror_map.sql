-- Add shadow_mirror_map (coconutGroupId → mirrorSwGroupId) for shadow write verification
alter table splitwise_tokens
  add column if not exists shadow_mirror_map jsonb default '{}'::jsonb;

-- Add debug_sync_state (coconutGroupId → ISO lastSync timestamp) for debug mirror routes
alter table splitwise_tokens
  add column if not exists debug_sync_state jsonb default '{}'::jsonb;
