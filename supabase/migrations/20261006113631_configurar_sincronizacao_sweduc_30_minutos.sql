create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
    timeout_milliseconds := 60000
  );
  $job$
);
