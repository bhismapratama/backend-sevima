import {SetMetadata} from '@nestjs/common';
import {WorkflowRole} from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: WorkflowRole[]) =>
  SetMetadata(ROLES_KEY, roles);
