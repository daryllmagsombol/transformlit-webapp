import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

interface PubSubTrigger {
  resolve: (value: IteratorResult<unknown>) => void;
}

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private listeners = new Map<string, PubSubTrigger[]>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL');
    this.pool = new Pool({ connectionString: url });
    const client = await this.pool.connect();

    client.on('notification', (msg) => {
      const payload = msg.payload ? JSON.parse(msg.payload) : null;
      const triggers = this.listeners.get(msg.channel) ?? [];
      if (triggers.length > 0) {
        const trigger = triggers.shift()!;
        trigger.resolve({ value: payload, done: false });
        this.listeners.set(msg.channel, triggers);
      }
    });

    // camelCase channel name, quoted so Postgres preserves case
    await client.query('LISTEN "messageAdded"');
    await client.query('LISTEN "notificationReceived"');

    // Keep connection open
    client.on('error', () => {});
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.pool.query('SELECT pg_notify($1, $2)', [
      channel,
      JSON.stringify(payload),
    ]);
  }

  asyncIterator<T>(triggerName: string): AsyncIterator<T> {
    return {
      next: () =>
        new Promise<IteratorResult<T>>((resolve) => {
          const existing = this.listeners.get(triggerName) ?? [];
          existing.push({ resolve: resolve as (v: IteratorResult<unknown>) => void });
          this.listeners.set(triggerName, existing);
        }) as Promise<IteratorResult<T>>,
      return: async () => {
        // listener cleanup happens naturally since it won't receive more events
        return { value: undefined as any, done: true };
      },
      throw: async () => ({ value: undefined as any, done: true }),
    };
  }
}
