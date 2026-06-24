import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? [
    'http://localhost:3000',
  ];

  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({ transform: true }),
  );

  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://localhost:${port}/graphql`);
}

bootstrap();
