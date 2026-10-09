create table private.crm_fiscal_bridge (
 id boolean primary key default true check(id),
 endpoint text not null default 'https://crm-matriculas-lovat.vercel.app/api/fiscal-sync',
 token text not null default encode(extensions.gen_random_bytes(32),'hex'),
 enabled boolean not null default false,
 created_at timestamptz not null default now()
);
alter table private.crm_fiscal_bridge enable row level security;
revoke all on private.crm_fiscal_bridge from public,anon,authenticated;
insert into private.crm_fiscal_bridge(id) values(true);
create function private.crm_publish_fiscal_snapshot() returns bigint language plpgsql security definer set search_path='' as $$
declare config private.crm_fiscal_bridge; payload jsonb; request_id bigint;
begin
 select * into config from private.crm_fiscal_bridge where id=true and enabled;
 if config.id is null then return null;end if;
 select jsonb_build_object('source_project','ncjtxysknpsloauzgmiv','synced_at',max(a.sincronizado_em),'records',jsonb_agg(jsonb_build_object(
 'matricula_id',a.matricula_id,'aluno_id',a.aluno_id,'nome',a.nome,'numero_aluno',a.numero_aluno,'numero_matricula',a.numero_matricula,'ano_letivo',a.ano_letivo,'status',a.status,'unidade',a.unidade,'curso',a.curso,'serie',a.serie,'turma',a.turma,'sincronizado_em',a.sincronizado_em,
 'responsaveis',coalesce((select jsonb_agg(jsonb_build_object('nome',coalesce(r->>'nome',r->>'nome_responsavel',r->>'responsavel'),'telefones',coalesce(r->'telefones',r->'telefone',r->'celular'),'emails',coalesce(r->'emails',r->'email'))) from jsonb_array_elements(a.responsaveis) r),'[]'::jsonb)
 ) order by a.matricula_id)) into payload from public.sweduc_alunos a
 where a.unidade in ('JPI - Matriz','JPI - Filial') and a.ano_letivo ~ '^[0-9]{4}$' and a.ano_letivo::integer between 2025 and extract(year from now() at time zone 'America/Sao_Paulo')::integer+1;
 if payload->'records' is null or jsonb_array_length(payload->'records')=0 then return null;end if;
 if octet_length(payload::text)>3500000 then raise exception 'Espelho excedeu limite de envio.';end if;
 select net.http_post(url:=config.endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||config.token),body:=payload,timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
revoke all on function private.crm_publish_fiscal_snapshot() from public,anon,authenticated;

-- Enable only after binding the verifier to the intended school and validating the first transfer.
-- update private.crm_fiscal_bridge set enabled=true where id=true;
select cron.schedule('jpi-crm-academic-mirror','7,37 * * * *','select private.crm_publish_fiscal_snapshot();');