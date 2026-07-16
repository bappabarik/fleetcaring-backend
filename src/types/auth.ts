export type ActorType = "CUSTOMER" | "PILOT" | "ADMIN";

export interface JwtPayload {
  sub: string; // actor's own id (User.id / Pilot.id / AdminUser.id)
  actorType: ActorType;
  roleId?: string; // ADMIN only
  permissions?: string[]; // ADMIN only — permission keys, or ["*"] for super admin
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}
