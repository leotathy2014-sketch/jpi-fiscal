create or replace function private.crm_sweduc_sync_control(p_action text default 'status',p_interval_minutes integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_job record;
 v_config record;
 v_schedule text;
 v_interval integer;
 v_next_run timestamptz;
 v_runs jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then
  raise exception 'Acesso restrito ao serviço interno.' using errcode='42501';
 end if;
 select jobid,schedule,active into v_job from cron.job where jobname='jpi-sweduc-sync-every-30-minutes' limit 1;
 if not found then raise exception 'Agendamento da sincronização SW Educ não encontrado.';end if;
 if p_action='set_interval' then
  if p_interval_minutes not in (5,10,15,20,30,60) then raise exception 'Intervalo não permitido.';end if;
  perform cron.alter_job(job_id:=v_job.jobid,schedule:=case when p_interval_minutes=60 then '0 * * * *' else '*/'||p_interval_minutes||' * * * *' end);
 elsif p_action='pause' then
  perform cron.alter_job(job_id:=v_job.jobid,active:=false);
 elsif p_action='resume' then
  perform cron.alter_job(job_id:=v_job.jobid,active:=true);
 elsif p_action<>'status' then
  raise exception 'Ação inválida.';
 end if;
 select jobid,schedule,active into v_job from cron.job where jobname='jpi-sweduc-sync-every-30-minutes' limit 1;
 v_schedule:=v_job.schedule;
 if v_schedule ~ '^\*/([0-9]+) \* \* \* \*$' then v_interval:=substring(v_schedule from '^\*/([0-9]+)')::integer;
 elsif v_schedule='0 * * * *' then v_interval:=60;
 else v_interval:=null;
 end if;
 if v_job.active and v_interval is not null then
  v_next_run:=date_trunc('hour',now())+make_interval(mins=>((floor(extract(minute from now())/v_interval)::integer+1)*v_interval));
 end if;
 select ultimo_status,ultimo_erro,sincronizada_em,total_sincronizado,updated_at into v_config from public.sweduc_config where id=true;
 select coalesce(jsonb_agg(jsonb_build_object('status',status,'startedAt',start_time,'endedAt',end_time,'message',left(coalesce(return_message,''),200)) order by start_time desc),'[]'::jsonb)
 into v_runs from (select status,start_time,end_time,return_message from cron.job_run_details where jobid=v_job.jobid order by start_time desc limit 10) recent;
 return jsonb_build_object(
  'ok',true,'active',v_job.active,'schedule',v_schedule,'intervalMinutes',v_interval,'nextRunAt',v_next_run,
  'lastSyncStatus',v_config.ultimo_status,'lastSyncError',v_config.ultimo_erro,'lastSyncAt',v_config.sincronizada_em,
  'totalSynced',v_config.total_sincronizado,'updatedAt',v_config.updated_at,'checks',v_runs
 );
end $$;
grant usage on schema private to service_role;
revoke all on function private.crm_sweduc_sync_control(text,integer) from public,anon,authenticated;
grant execute on function private.crm_sweduc_sync_control(text,integer) to service_role;
create or replace function public.crm_sweduc_sync_control(p_action text default 'status',p_interval_minutes integer default null)
returns jsonb language sql security invoker set search_path='' as $$select private.crm_sweduc_sync_control(p_action,p_interval_minutes)$$;
revoke all on function public.crm_sweduc_sync_control(text,integer) from public,anon,authenticated;
grant execute on function public.crm_sweduc_sync_control(text,integer) to service_role;
