import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource=readFileSync(new URL("../components/live-pages.tsx",import.meta.url),"utf8");
const stylesSource=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");
const closingMigration=readFileSync(new URL("../supabase/migrations/20260918150731_criar_fechamento_competencia_mensal.sql",import.meta.url),"utf8");

test("restaura o painel mensal com competência, indicadores, gráficos e relatórios",()=>{
  for(const content of ["Painel mensal","Competência analisada","Total faturado","Total recebido","NFS-e emitidas","Faturamento e recebimentos","Exportar Excel","Imprimir / PDF"]){
    assert.ok(dashboardSource.includes(content),`item ausente no painel: ${content}`);
  }
  assert.match(dashboardSource,/type="month"/);
  assert.match(dashboardSource,/DashboardChartType = "line" \| "bars" \| "distribution"/);
  assert.match(stylesSource,/\.monthly-dashboard\{display:grid;gap:16px\}/);
  assert.match(stylesSource,/\.dashboard-kpis\{display:grid;grid-template-columns:repeat\(4,1fr\)/);
});

test("fecha somente competências válidas e mantém reabertura exclusiva do Master",()=>{
  assert.match(dashboardSource,/can\("dashboard\.close"\)/);
  assert.match(dashboardSource,/supabase\.rpc\("close_monthly_competence"/);
  assert.match(dashboardSource,/supabase\.rpc\("reopen_monthly_competence"/);
  assert.match(dashboardSource,/activeClosing&&isMaster/);
  assert.match(closingMigration,/private\.has_jpi_permission\('dashboard\.close'\)/);
  assert.match(closingMigration,/private\.current_jpi_raw_role\(\)<>'master'/);
  assert.match(closingMigration,/alter table public\.monthly_closings enable row level security/);
  assert.match(closingMigration,/revoke all on table public\.monthly_closings from anon,authenticated/);
  assert.match(closingMigration,/grant select on table public\.monthly_closings to authenticated/);
});
