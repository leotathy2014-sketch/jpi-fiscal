import type { Metadata } from "next";
import { ProtectedNote } from "./protected-note";

export const metadata:Metadata={title:"NFS-e protegida | JPI Fiscal",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function NotePage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <ProtectedNote token={token}/>}
