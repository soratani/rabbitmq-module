import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as amqp from 'amqp-connection-manager';
import type { Channel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { RabbitMQClientOptions } from './interfaces/rabbitmq-options.interface';
import type { RabbitMQModuleOptions } from './interfaces/rabbitmq-options.interface';

/** A named AMQP connection. Channel methods intentionally retain the full amqplib API. */
@Injectable()
export class RabbitMQClient implements OnApplicationShutdown {
  private readonly manager: AmqpConnectionManager;

  constructor(readonly name: string, options: RabbitMQClientOptions) {
    const urls = resolveUrls(name, options);
    this.manager = amqp.connect(urls, {
      ...(options.managerOptions ?? {}),
      connectionOptions: options.connectionOptions ?? options.managerOptions?.connectionOptions,
    });
  }

  /** Underlying reconnecting connection manager, including connect/disconnect events. */
  get connection(): AmqpConnectionManager { return this.manager; }

  /** Create a managed channel; setup is replayed after every reconnect. */
  createChannel(options?: Parameters<AmqpConnectionManager['createChannel']>[0]): ChannelWrapper {
    return this.manager.createChannel(options);
  }

  /** Create a raw amqplib channel for direct access to every AMQP operation. */
  async createRawChannel(confirm = false): Promise<Channel | ConfirmChannel> {
    if (!this.manager.connection) {
      await new Promise<void>((resolve) => this.manager.once('connect', () => resolve()));
    }
    const connection = this.manager.connection;
    if (!connection) throw new Error(`RabbitMQ client "${this.name}" is not connected`);
    return confirm ? connection.createConfirmChannel() : connection.createChannel();
  }

  async close(): Promise<void> { await this.manager.close(); }

  async onApplicationShutdown(): Promise<void> { await this.close(); }
}

function resolveUrls(name: string, options: RabbitMQClientOptions): string[] {
  if (options.protocol !== undefined && options.protocol !== 'amqp' && options.protocol !== 'amqps') {
    throw new Error(`RabbitMQ client "${name}": protocol must be either "amqp" or "amqps"`);
  }
  if (options.url !== undefined && options.urls !== undefined) {
    throw new Error(`RabbitMQ client "${name}": configure either "url" or "urls", not both`);
  }
  const explicitUrls = options.urls === undefined
    ? (options.url === undefined ? undefined : [options.url])
    : typeof options.urls === 'string' ? [options.urls] : options.urls;
  const tlsOptions = options.connectionOptions ?? options.managerOptions?.connectionOptions;
  const tlsOptionNames = ['ca', 'cert', 'key', 'pfx', 'passphrase', 'servername', 'rejectUnauthorized', 'minVersion', 'maxVersion', 'ciphers', 'secureProtocol', 'checkServerIdentity'];
  const hasTlsOptions = Boolean(tlsOptions && tlsOptionNames.some((key) => (tlsOptions as Record<string, unknown>)[key] !== undefined));
  const hostFieldsWithUrl = ['host', 'port', 'user', 'password', 'vhost'];
  if (explicitUrls && hostFieldsWithUrl.some((key) => (options as Record<string, unknown>)[key] !== undefined)) {
    throw new Error(`RabbitMQ client "${name}": do not mix "url"/"urls" with host-based fields (${hostFieldsWithUrl.join(', ')})`);
  }
  if (explicitUrls) {
    if (explicitUrls.length === 0 || explicitUrls.some((url) => !url.trim())) {
      throw new Error(`RabbitMQ client "${name}": "urls" must contain at least one non-empty URL`);
    }
    for (const value of explicitUrls) {
      let parsed: URL;
      try { parsed = new URL(value); } catch {
        throw new Error(`RabbitMQ client "${name}": invalid AMQP URL "${value}"`);
      }
      if (parsed.protocol !== 'amqp:' && parsed.protocol !== 'amqps:') {
        throw new Error(`RabbitMQ client "${name}": URL protocol must be amqp:// or amqps://`);
      }
      if (options.protocol && parsed.protocol !== `${options.protocol}:`) {
        throw new Error(`RabbitMQ client "${name}": protocol "${options.protocol}" conflicts with URL "${value}"`);
      }
      if (hasTlsOptions && parsed.protocol !== 'amqps:') {
        throw new Error(`RabbitMQ client "${name}": TLS options require an amqps:// URL`);
      }
    }
    return explicitUrls;
  }
  if (!options.host?.trim()) throw new Error(`RabbitMQ client "${name}": provide "url", "urls", or "host"`);
  const protocol = options.protocol ?? 'amqp';
  if (hasTlsOptions && protocol !== 'amqps') {
    throw new Error(`RabbitMQ client "${name}": TLS options require protocol "amqps"`);
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error(`RabbitMQ client "${name}": port must be an integer between 1 and 65535`);
  }
  const host = options.host.includes(':') && !options.host.startsWith('[') ? `[${options.host}]` : options.host;
  const port = options.port ?? (protocol === 'amqps' ? 5671 : 5672);
  const user = encodeURIComponent(options.user ?? 'guest');
  const password = encodeURIComponent(options.password ?? 'guest');
  const vhost = options.vhost ?? '/';
  const path = vhost === '/' ? '/' : `/${encodeURIComponent(vhost)}`;
  return [`${protocol}://${user}:${password}@${host}:${port}${path}`];
}

/** Registry for clients whose names are known only after async configuration resolves. */
export class RabbitMQClients implements OnApplicationShutdown {
  private readonly clients: Map<string, RabbitMQClient>;

  constructor(options: RabbitMQModuleOptions) {
    const configs: Record<string, RabbitMQClientOptions> = { ...(options.clients ?? {}) };
    if (options.urls || options.url || options.host) {
      const primaryName = options.name ?? 'default';
      if (!configs[primaryName]) configs[primaryName] = {
        url: options.url,
        urls: options.urls,
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        protocol: options.protocol,
        vhost: options.vhost,
        connectionOptions: options.connectionOptions,
        managerOptions: options.managerOptions,
      };
    }
    this.clients = new Map(Object.entries(configs).map(([name, config]) => [name, new RabbitMQClient(name, config)]));
  }

  get(name = 'default'): RabbitMQClient {
    const client = this.clients.get(name);
    if (!client) throw new Error(`RabbitMQ client "${name}" is not configured`);
    return client;
  }

  has(name: string): boolean { return this.clients.has(name); }
  names(): string[] { return [...this.clients.keys()]; }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.close()));
  }
}

export type { Channel, ConfirmChannel, ConsumeMessage, Options };
