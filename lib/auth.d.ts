import type { DefaultSession } from "next-auth";

type SessionGrant = { action: string; grant: "ALLOW" | "DENY" };

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      centerId: string | null;
      grants: SessionGrant[];
      tokenVersion: number;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/types" {
  interface User {
    role?: string;
    centerId?: string | null;
    grants?: SessionGrant[];
    tokenVersion?: number;
  }
}
