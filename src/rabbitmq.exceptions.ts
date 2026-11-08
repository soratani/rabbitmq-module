import { BadRequestException } from '@nestjs/common';

/** Raised during module initialization when RabbitMQ options conflict or are incomplete. */
export class RabbitMQConfigurationException extends BadRequestException {
  constructor(message: string) {
    super({
      statusCode: 400,
      error: 'Invalid RabbitMQ configuration',
      message,
    });
  }
}
