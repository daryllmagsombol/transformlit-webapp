import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module.js';
import { ConversionRunner } from '../books/conversion/conversion.runner.js';
import { ConversionJobService } from '../books/conversion/conversion-job.service.js';

const POLL_INTERVAL_MS = 2000;
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function bootstrap(): Promise<void> {
  const logger = new Logger('BookConversionWorker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn', 'log'] });
  const runner = app.get(ConversionRunner);
  const jobs = app.get(ConversionJobService);

  let running = true;
  const shutdown = async () => {
    running = false;
    await app.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let lastSweep = 0;
  logger.log('Book conversion worker started');
  while (running) {
    if (Date.now() - lastSweep > STALE_SWEEP_INTERVAL_MS) {
      lastSweep = Date.now();
      const requeued = await jobs.requeueStale(15 * 60 * 1000);
      if (requeued > 0) logger.warn(`Requeued ${requeued} stale conversion job(s)`);
    }
    const worked = await runner.runOnce().catch((error: Error) => {
      logger.error(`Worker loop error: ${error.message}`);
      return false;
    });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

bootstrap().catch((error) => {
  console.error('Book conversion worker crashed', error);
  process.exitCode = 1;
});
