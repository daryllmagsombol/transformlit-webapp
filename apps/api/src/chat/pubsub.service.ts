import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

interface PubSubTrigger<T = unknown> {
  resolve: (value: { value: T; done: boolean }) => void;
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
      const triggers = this.listeners.get(msg.channel) ?? [];
      const payload = msg.payload ? JSON.parse(msg.payload) : null;
      for (const trigger of triggers) {
        trigger.resolve({ value: payload, done: false });
      }
      this.listeners.set(msg.channel, []);
    });

    await client.query('LISTEN message_added');
    await client.query('LISTEN friend_request');
    await client.query('LISTEN group_updated');

    // Keep connection open
    client.on('error', () => {});
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.pool.query('NOTIFY $1, $2', [
      channel,
      JSON.stringify(payload),
    ]);
  }

  asyncIterator<T>(triggerName: string): AsyncIterator<T> {
    const channel = triggerName; // map to PG channel name
    return {
      next: () =>
        new Promise<IteratorResult<T>>((resolve) => {
          const existing = this.listeners.get(channel) ?? [];
          existing.push({ resolve });
          this.listeners.set(channel, existing);
        }),
      return: async () => ({ value: undefined as any, done: true }),
      throw: async () => ({ value: undefined as any, done: true }),
    };
  }
}
