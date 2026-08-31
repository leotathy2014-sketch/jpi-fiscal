"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

type AccessContextValue={
  role:string;
  permissions:string[];
  isMaster:boolean;
  can:(permissionKey:string)=>boolean;
  canAny:(permissionKeys:string[])=>boolean;
};

const AccessContext=createContext<AccessContextValue>({
  role:"Consulta",
  permissions:[],
  isMaster:false,
  can:()=>false,
  canAny:()=>false,
});

export function AccessProvider({role,permissions,children}:{role:string;permissions:string[];children:ReactNode}){
  const value=useMemo<AccessContextValue>(()=>{
    const allowed=new Set(permissions);
    const isMaster=role==="Master";
    return {
      role,
      permissions,
      isMaster,
      can:(key)=>isMaster||allowed.has(key),
      canAny:(keys)=>isMaster||keys.some(key=>allowed.has(key)),
    };
  },[role,permissions]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(){
  return useContext(AccessContext);
}
