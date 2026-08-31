import type { SupabaseClient } from "@supabase/supabase-js";

export async function hasServerPermission(supabase:SupabaseClient,permissionKey:string){
  const {data,error}=await supabase.rpc("has_jpi_permission",{p_permission_key:permissionKey});
  return !error&&data===true;
}
