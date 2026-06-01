export type JwtPayload = {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
};

export type AuthUser = {
  id: string;
  tenantId: string;
  role: string;
  email: string;
};
