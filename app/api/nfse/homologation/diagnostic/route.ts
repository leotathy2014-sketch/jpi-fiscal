import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(){
  const ready=Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    process.env.JPI_BACKEND_SECRET
  );
  return NextResponse.json(
    {ok:true,homologationBackendReady:ready},
    {headers:{"Cache-Control":"no-store"}}
  );
}
