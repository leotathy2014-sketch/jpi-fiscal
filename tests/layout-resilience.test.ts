import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/live-pages.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("mantém a fonte Inter mesmo se a classe gerada ficar temporariamente fora de sincronia", () => {
  assert.match(layoutSource, /className=\{inter\.className\}/);
  assert.match(layoutSource, /style=\{inter\.style\}/);
});

test("usa controles próprios e alinhados para período e atualização do painel", () => {
  assert.match(dashboardSource, /className="dashboard-period-actions"/);
  assert.match(dashboardSource, /className="secondary dashboard-refresh-button"/);
  assert.doesNotMatch(dashboardSource, /action=\{<div className="form-actions">/);
  assert.match(stylesSource, /\.dashboard-period-actions\{display:flex;align-items:center;gap:10px\}/);
  assert.match(stylesSource, /\.dashboard-refresh-button\{min-height:42px/);
});
