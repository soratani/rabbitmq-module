import { Inject } from '@nestjs/common';
import { RABBITMQ_CLIENTS, getRabbitMQToken } from './rabbitmq.constants';

export const InjectRabbitMQ = (name = 'default'): ReturnType<typeof Inject> => Inject(getRabbitMQToken(name));

/** Inject the registry used to resolve names returned by forRootAsync(). */
export const InjectRabbitMQClients = (): ReturnType<typeof Inject> => Inject(RABBITMQ_CLIENTS);
