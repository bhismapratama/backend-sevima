import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import {type Response} from 'express';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

interface ApiResponse<T = unknown> {
  statusCode: number;
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor<
  unknown,
  ApiResponse
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<ApiResponse> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map(
        (data: unknown): ApiResponse => ({
          statusCode: response.statusCode,
          message: 'Berhasil',
          data: data ?? null,
        }),
      ),
    );
  }
}
