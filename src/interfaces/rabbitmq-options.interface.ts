import type { AmqpConnectionManagerOptions, AmqpConnectionManager as ConnectionManager } from 'amqp-connection-manager';

export const RABBITMQ_DEFAULT_CLIENT = 'default';

export interface RabbitMQClientOptions {
  /** A single broker URL. Use this or host-based fields. */
  url?: string;
  /** An ordered list of node URLs (cluster/failover). Use this or host-based fields. */
  urls?: string | string[];
  /** Broker host. When set, the module builds the AMQP URL from the fields below. */
  host?: string;
  /** Broker port; defaults to 5672 for amqp and 5671 for amqps. */
  port?: number;
  /** Broker username; defaults to guest when using host-based configuration. */
  user?: string;
  /** Broker password; defaults to guest when using host-based configuration. */
  password?: string;
  /** Host-based connection protocol; defaults to amqp. */
  protocol?: 'amqp' | 'amqps';
  /** Virtual host; defaults to `/`. */
  vhost?: string;
  /** Socket/TLS options passed through to amqplib. */
  connectionOptions?: AmqpConnectionManagerOptions['connectionOptions'];
  /** amqp-connection-manager options (heartbeat, reconnect time, etc.). */
  managerOptions?: AmqpConnectionManagerOptions;
}

export interface RabbitMQModuleOptions extends RabbitMQClientOptions {
  name?: string;
  /** Named clients permit distinct publisher/subscriber connections in one app. */
  clients?: Record<string, RabbitMQClientOptions>;
}

export interface RabbitMQModuleAsyncOptions {
  name?: string;
  imports?: Array<unknown>;
  inject?: Array<unknown>;
  useFactory: (...args: any[]) => Promise<RabbitMQModuleOptions> | RabbitMQModuleOptions;
}

export type RabbitMQConnectionManager = ConnectionManager;
