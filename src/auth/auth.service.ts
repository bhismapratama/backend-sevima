import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {JwtService} from '@nestjs/jwt';
import {WorkflowRole} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {PrismaService} from 'infra/database/prisma.service';
import {
  LoginDto,
  RegisterDto,
  AddMemberDto,
  UpdateMemberDto,
  UpdateProfileDto,
} from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingTenant = await this.prisma.tenant.findUnique({
      where: {slug: dto.tenantSlug},
    });
    if (existingTenant)
      throw new ConflictException('Slug tenant sudah diambil');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.tenantName,
        slug: dto.tenantSlug,
        users: {
          create: {
            email: dto.email,
            passwordHash,
            role: dto.role ?? WorkflowRole.ADMIN,
          },
        },
      },
      include: {users: true},
    });

    const user = tenant.users[0];
    return {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {email: dto.email},
      include: {tenant: true},
    });

    if (!user) throw new UnauthorizedException('Kredensial tidak valid');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Kredensial tidak valid');

    return {
      accessToken: this.signToken(
        user.id,
        user.email,
        user.tenantId,
        user.role,
      ),
    };
  }

  async addMember(tenantId: string, dto: AddMemberDto) {
    const existing = await this.prisma.user.findFirst({
      where: {email: dto.email, tenantId},
    });
    if (existing)
      throw new ConflictException(
        'Pengguna dengan email ini sudah ada di ruang kerja',
      );

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash,
        role: dto.role ?? WorkflowRole.VIEWER,
      },
      select: {id: true, email: true, role: true, createdAt: true},
    });

    return user;
  }

  async listMembers(tenantId: string) {
    return this.prisma.user.findMany({
      where: {tenantId},
      select: {id: true, email: true, role: true, createdAt: true},
      orderBy: {createdAt: 'asc'},
    });
  }

  async removeMember(tenantId: string, userId: string, requesterId: string) {
    if (userId === requesterId)
      throw new ConflictException('Tidak dapat menghapus akun Anda sendiri');

    const user = await this.prisma.user.findFirst({
      where: {id: userId, tenantId},
    });
    if (!user) throw new ConflictException('Pengguna tidak ditemukan');

    await this.prisma.user.delete({where: {id: userId}});
    return {deleted: true};
  }

  async updateMember(tenantId: string, userId: string, dto: UpdateMemberDto) {
    const user = await this.prisma.user.findFirst({
      where: {id: userId, tenantId},
    });
    if (!user) throw new ConflictException('Pengguna tidak ditemukan');

    if (dto.email) {
      const emailTaken = await this.prisma.user.findFirst({
        where: {email: dto.email, tenantId, NOT: {id: userId}},
      });
      if (emailTaken) throw new ConflictException('Email sudah digunakan');
    }

    const data: Record<string, unknown> = {};
    if (dto.email) data.email = dto.email;
    if (dto.role) data.role = dto.role;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.update({
      where: {id: userId},
      data,
      select: {id: true, email: true, role: true, createdAt: true},
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const emailTaken = await this.prisma.user.findFirst({
        where: {email: dto.email, NOT: {id: userId}},
      });
      if (emailTaken) throw new ConflictException('Email sudah digunakan');
    }

    const data: Record<string, unknown> = {};
    if (dto.email) data.email = dto.email;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.update({
      where: {id: userId},
      data,
      select: {id: true, email: true, role: true, createdAt: true},
    });
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: {id: userId},
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        tenant: {select: {id: true, name: true, slug: true}},
        createdAt: true,
      },
    });
  }

  private signToken(
    sub: string,
    email: string,
    tenantId: string,
    role: WorkflowRole,
  ): string {
    return this.jwt.sign({sub, email, tenantId, role});
  }
}
