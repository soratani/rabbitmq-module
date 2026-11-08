import { DynamicModule, Module, Provider } from '@nestjs/common';
import { RabbitMQClient, RabbitMQClients } from './rabbitmq-client';
import { RABBITMQ_CLIENTS, RABBITMQ_OPTIONS, getRabbitMQToken } from './rabbitmq.constants';
import type { RabbitMQModuleAsyncOptions, RabbitMQModuleOptions } from './interfaces/rabbitmq-options.interface';
import { RabbitMQConfigurationException } from './rabbitmq.exceptions';

function hasConnectionConfig(options: RabbitMQModuleOptions): boolean {
  return Boolean(options.url || options.urls || options.host);
}

function clientProvider(name: string): Provider {
  return {
    provide: getRabbitMQToken(name),
    useFactory: (options: RabbitMQModuleOptions) => {
      const clientOptions = options.clients?.[name] ?? (name === (options.name ?? 'default') && hasConnectionConfig(options) ? options : undefined);
      if (!clientOptions) throw new RabbitMQConfigurationException(`RabbitMQ client "${name}" is not configured`);
      return new RabbitMQClient(name, clientOptions as import('./interfaces/rabbitmq-options.interface').RabbitMQClientOptions);
    },
    inject: [RABBITMQ_OPTIONS],
  };
}

@Module({})
export class RabbitMQModule {
  static forRoot(options: RabbitMQModuleOptions): DynamicModule {
    const clients = options.clients ?? {};
    const primaryName = options.name ?? 'default';
    const names = new Set(Object.keys(clients));
    if (hasConnectionConfig(options)) names.add(primaryName);
    const providers: Provider[] = [
      { provide: RABBITMQ_OPTIONS, useValue: options },
      ...[...names].map(clientProvider),
    ];
    return { module: RabbitMQModule, global: true, providers, exports: providers.filter((p) => 'provide' in p).map((p) => p.provide!) };
  }

  static forRootAsync(options: RabbitMQModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: RABBITMQ_OPTIONS,
      useFactory: options.useFactory,
      inject: (options.inject ?? []) as any[],
    };
    const clientsProvider: Provider = {
      provide: RABBITMQ_CLIENTS,
      useFactory: (all: RabbitMQModuleOptions) => new RabbitMQClients(all),
      inject: [RABBITMQ_OPTIONS],
    };
    const providers: Provider[] = [optionsProvider, clientsProvider];
    return { module: RabbitMQModule, global: true, imports: options.imports as DynamicModule['imports'], providers, exports: [RABBITMQ_CLIENTS, RABBITMQ_OPTIONS] };
  }
}
