export const RABBITMQ_OPTIONS = Symbol('RABBITMQ_OPTIONS');
export const RABBITMQ_CONNECTIONS = Symbol('RABBITMQ_CONNECTIONS');
export const RABBITMQ_CLIENTS = Symbol('RABBITMQ_CLIENTS');

export function getRabbitMQToken(name = 'default'): string {
  return `RABBITMQ_CONNECTION_${name}`;
}
