export const SAFE_PILOT_SELECT = {
  id: true,
  code: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  verticalId: true,
  status: true,
  preferredNavApp: true,
  language: true,
  createdAt: true,
} as const;

export const SAFE_ADMIN_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  roleId: true,
  isActive: true,
  createdAt: true,
} as const;