import type { RoleName } from './auth.types';

/** Roles allowed to change surveys, projects and vendors. */
export const CAN_EDIT: RoleName[] = ['ADMIN', 'PROGRAMMER'];

/** Every role, including field interviewers (who can otherwise only reach endpoints that name them). */
export const ALL_ROLES: RoleName[] = ['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER'];
