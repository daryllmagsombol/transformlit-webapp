import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { ConfigService } from '@nestjs/config';

interface PubSubTrigger {
  resolve: (value: IteratorResult<unknown>) => void;
  /** Identity of the iterator that registered this trigger, for cleanup. */
  owner: symbol;
}

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private listenClient?: PoolClient;
  private readonly listeners = new Map<string, PubSubTrigger[]>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL');
    this.pool = new Pool({ connectionString: url });
    const client = await this.pool.connect();
    this.listenClient = client;

    client.on('notification', (msg) => this.handleNotification(msg));

    // camelCase channel name, quoted so Postgres preserves case
    await client.query('LISTEN "messageAdded"');
    await client.query('LISTEN "notificationReceived"');

    // Keep connection open
    // Realtime dies silently if the LISTEN connection drops; log loudly so
    // operators notice (process restart restores the subscription).
    client.on('error', (err) => {
      console.error('[pubsub] Postgres LISTEN connection error:', err.message);
    });
  }

  /**
   * Handles a pg 'notification' event. Payloads are JSON-encoded by publish();
   * a rogue or malformed pg_notify payload must never throw out of the pg
   * client's event emitter (an uncaught throw there can crash the process), so
   * parse failures are logged and the message is skipped without resolving any
   * waiting triggers.
   */
  private handleNotification(msg: { channel: string; payload?: string | null }) {
    let payload: unknown = null;
    if (msg.payload) {
      try {
        payload = JSON.parse(msg.payload);
      } catch {
        console.error('[pubsub] Ignoring notification with malformed JSON payload:', msg.payload);
        return;
      }
    }

    const triggers = this.listeners.get(msg.channel) ?? [];
    if (triggers.length > 0) {
      // Broadcast: one NOTIFY wakes every waiting subscriber for the channel,
      // so all concurrent subscriptions receive each event.
      this.listeners.set(msg.channel, []);
      for (const trigger of triggers) {
        trigger.resolve({ value: payload, done: false });
      }
    }
  }

  async onModuleDestroy() {
    // Release the dedicated LISTEN connection back to the pool before ending it.
    // Pool.end() waits for every checked-out client, so an unreleased LISTEN
    // client would hang shutdown (and the schema export/check commands) forever.
    if (this.listenClient) {
      try {
        // Stop delivering notifications before we hand the connection back;
        // otherwise a pooled/reused client would keep forwarding NOTIFYs into
        // this (now discarded) service instance.
        await this.listenClient.query('UNLISTEN *');
      } catch {
        // A broken connection cannot be unlistened; proceed to release.
      }
      this.listenClient.removeAllListeners('notification');
      this.listenClient.removeAllListeners('error');
      this.listenClient.release();
      this.listenClient = undefined;
    }
    this.listeners.clear();
    await this.pool.end();
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.pool.query('SELECT pg_notify($1, $2)', [
      channel,
      JSON.stringify(payload),
    ]);
  }

  asyncIterator<T>(triggerName: string): AsyncIterator<T> {
    const owner = Symbol(triggerName);
    return {
      next: () =>
        new Promise<IteratorResult<T>>((resolve) => {
          const existing = this.listeners.get(triggerName) ?? [];
          existing.push({ resolve: resolve as (v: IteratorResult<unknown>) => void, owner });
          this.listeners.set(triggerName, existing);
        }),
      return: () => {
        // Remove every still-pending trigger for THIS iterator so a subscriber
        // that unsubscribes without consuming a value is not retained forever
        // (and cannot be woken by a later notification).
        this.detach(triggerName, owner);
        return Promise.resolve({ value: undefined as unknown, done: true });
      },
      throw: () => {
        this.detach(triggerName, owner);
        return Promise.resolve({ value: undefined as unknown, done: true });
      },
    };
  }

  private detach(triggerName: string, owner: symbol): void {
    const remaining = (this.listeners.get(triggerName) ?? []).filter((trigger) => trigger.owner !== owner);
    if (remaining.length === 0) this.listeners.delete(triggerName);
    else this.listeners.set(triggerName, remaining);
  }
}
