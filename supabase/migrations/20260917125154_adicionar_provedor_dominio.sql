alter table public.domain_settings
  add column if not exists dns_provider text not null default 'locaweb';

alter table public.domain_settings
  drop constraint if exists domain_settings_dns_provider_check;

alter table public.domain_settings
  add constraint domain_settings_dns_provider_check
  check (dns_provider in ('locaweb','registro_br'));

comment on column public.domain_settings.dns_provider is
  'Painel onde o Master administrará o DNS: Locaweb ou Registro.br.';
