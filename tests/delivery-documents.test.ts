import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource=readFileSync(new URL("../app/api/deliveries/documents/route.ts",import.meta.url),"utf8");
const uiSource=readFileSync(new URL("../components/delivery-center.tsx",import.meta.url),"utf8");

test("protege a visualização e o download dos documentos fiscais",()=>{
  assert.match(routeSource,/supabase\.auth\.getUser\(token\)/);
  assert.match(routeSource,/allowedRoles\.includes\(access\.role\)/);
  assert.match(routeSource,/storage\.from\(XML_BUCKET\)\.download/);
  assert.match(routeSource,/"Cache-Control":"private, no-store, max-age=0"/);
  assert.match(routeSource,/"X-Content-Type-Options":"nosniff"/);
});

test("oferece PDF e XML separados somente nas notas enviadas",()=>{
  assert.match(uiSource,/state==="enviado"&&<>/);
  assert.match(uiSource,/<div className="delivery-files">/);
  assert.match(uiSource,/handleDocument\(row\.document\.id,"pdf","inline"\)/);
  assert.match(uiSource,/handleDocument\(row\.document\.id,"pdf","attachment"\)/);
  assert.match(uiSource,/handleDocument\(row\.document\.id,"xml","inline"\)/);
  assert.match(uiSource,/handleDocument\(row\.document\.id,"xml","attachment"\)/);
  assert.match(routeSource,/buildDanfsePdf/);
  assert.match(routeSource,/"application\/pdf"/);
  assert.match(routeSource,/"application\/xml; charset=utf-8"/);
});

test("impede reenvio acidental de uma nota já enviada",()=>{
  assert.match(uiSource,/deliveryState\(row\)!=="enviado"/);
  assert.match(uiSource,/state!=="enviado"\?<input type="checkbox"/);
});
