import {Body, Controller, Delete, Get, Param, Patch, Post, UseGuards} from '@nestjs/common';
import {ApiBearerAuth, ApiTags} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {ThrottlerGuard} from '@nestjs/throttler';
import {CurrentUser} from 'common/decorators/current-user.decorator';
import {AuthenticatedUser} from 'common/interfaces/authenticated-user.interface';
import {JwtGuard} from 'common/guards/jwt.guard';
import {RolesGuard} from 'common/guards/roles.guard';
import {Roles} from 'common/decorators/roles.decorator';
import {WorkflowRole} from '@prisma/client';
import {AuthService} from './auth.service';
import {LoginDto, RegisterDto, AddMemberDto, UpdateMemberDto, UpdateProfileDto} from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({default: {limit: 10, ttl: 60_000}})
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({default: {limit: 5, ttl: 60_000}})
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  @Get('members')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Roles(WorkflowRole.ADMIN)
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listMembers(user.tenantId);
  }

  @Post('members')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Roles(WorkflowRole.ADMIN)
  addMember(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddMemberDto) {
    return this.authService.addMember(user.tenantId, dto);
  }

  @Patch('members/:userId')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Roles(WorkflowRole.ADMIN)
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.authService.updateMember(user.tenantId, userId, dto);
  }

  @Delete('members/:userId')
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Roles(WorkflowRole.ADMIN)
  removeMember(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.authService.removeMember(user.tenantId, userId, user.id);
  }

  @Patch('me')
  @UseGuards(JwtGuard, ThrottlerGuard)
  @ApiBearerAuth()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }
}
