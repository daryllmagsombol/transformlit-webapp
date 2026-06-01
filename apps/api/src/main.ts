import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const defaultOrigins = ['http://localhost:3000'];
  const configuredOrigins =
    process.env.CORS_ORIGIN ?? process.env.FRONTEND_ORIGIN;
  const origins = configuredOrigins
    ? configuredOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : defaultOrigins;

  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
