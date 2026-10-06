select cron.schedule(
  'jpi-sweduc-sync-every-30-minutes',
  '*/30 * * * *',
  $job$
  select net.http_get(
    url := 'https://jpifiscal.jejoaopaulo.com.br/api/cron/sweduc-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'jpi_sweduc_sync_token'
        limit 1
      )
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
