import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {WorkflowRole} from '@prisma/client';
import {ROLES_KEY} from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<WorkflowRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const {user} = context
      .switchToHttp()
      .getRequest<{user?: {role: WorkflowRole}}>();

    if (!user) throw new ForbiddenException('Tidak ada pengguna yang terautentikasi');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Peran yang diperlukan: ${required.join(' atau ')}. Peran Anda: ${user.role}`,
      );
    }

    return true;
  }
}
