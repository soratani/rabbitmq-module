# @soratani-code/rabbitmq-module

适用于 NestJS 的 RabbitMQ 模块。支持静态配置、异步外部配置、单节点或多节点连接地址、多个具名客户端、断线重连，以及通过 `amqplib` 使用原生 AMQP channel API。

## 能力概览

- **配置方式**：`RabbitMQModule.forRoot()` 静态配置；`forRootAsync()` 从 ConfigService、环境变量封装服务或其他 Nest provider 获取配置。
- **单机和集群**：可使用 `url` / `urls`，也可使用 `host`、`port`、`user`、`password` 字段。`urls` 支持多个集群节点地址；连接管理器会在连接断开后自动重连，并按地址列表尝试连接。
- **多个连接**：一个 Nest 应用内可创建 `publisher`、`subscriber` 等不同名字的客户端，分别设置地址和连接参数。
- **异步具名客户端**：`forRootAsync()` 返回的 `clients` 对象 key 就是客户端名，无需另外声明名称；通过客户端注册表按 key 取用。
- **配置异常提示**：URL/主机字段冲突、协议不支持、TLS 参数与协议不匹配、连接地址缺失等配置错误会抛出 JavaScript 原生 `Error`，错误信息会指出客户端名和问题字段。
- **完整 AMQP 操作**：托管 channel 的 setup 回调拿到原生 amqplib channel；需要直接控制连接/channel 时，也可取连接管理器或创建 raw channel。
- **托管 channel 自动恢复**：每次重连后托管 channel 会重新执行 `setup`，适合恢复 exchange、queue、binding 和 consumer。
- **生命周期管理**：Nest 应用关闭时自动关闭模块创建的客户端；也可调用 `client.close()` 提前关闭。

> 多个节点 URL 是故障转移/重连地址。RabbitMQ 集群的队列、exchange 和 binding 是否可用仍取决于服务端集群拓扑及队列类型（例如 quorum queue）；客户端模块不会自动将单机 Broker 变成集群。

## 安装

```bash
pnpm add @soratani-code/rabbitmq-module
```

NestJS 应用还需安装并配置 `@nestjs/common`、`reflect-metadata` 和 `rxjs`（它们由本包作为 peer dependency 使用）。

## 1. 单机静态配置

在根模块可直接提供纯 URL：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

@Module({
  imports: [
    RabbitMQModule.forRoot({
      urls: 'amqp://guest:guest@localhost:5672',
    }),
  ],
})
export class AppModule {}
```

未指定名字的连接默认注入名为 `default`。URL 通常格式为 `amqp://用户名:密码@主机:端口/虚拟主机`；如密码或虚拟主机含特殊字符，需按 URL 规则编码。

也可以不用拼 URL，直接使用主机和认证字段：

```ts
RabbitMQModule.forRoot({
  host: 'rabbit.internal',
  port: 5672,
  user: 'orders_app',
  password: 'secret',
  vhost: 'orders',
});
```

`port` 默认在 `amqp` 协议下为 `5672`，`amqps` 下为 `5671`；`user` 和 `password` 默认值为 `guest`，`vhost` 默认值为 `/`。需要 TLS 时设置 `protocol: 'amqps'` 并按需设置 TLS 连接参数。

`url` / `urls` 与 `host` 配置模式不可混用。若 `url` / `urls` 中同时指定 `protocol`，它必须与 URL 自身的 `amqp://` 或 `amqps://` 一致。TLS 的 CA、证书或密钥等参数只能配合 `amqps` 使用；配置为 `amqp` 时模块会在初始化阶段抛出原生异常，而不是尝试建立错误连接。

例如，下面的配置会在 Nest 创建 RabbitMQ provider 时抛出原生 `Error`，提示 TLS 参数要求使用 `amqps`：

```ts
import { readFileSync } from 'node:fs';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

RabbitMQModule.forRoot({
  host: 'rabbit.internal',
  protocol: 'amqp', // 配有 CA 时必须改为 amqps
  connectionOptions: { ca: [readFileSync('./rabbit-ca.pem')] },
});
```

配置错误可按原生 `Error` 捕获：

```ts
import { NestFactory } from '@nestjs/core';

async function bootstrap(): Promise<void> {
  try {
    await NestFactory.create(AppModule);
  } catch (error) {
    if (error instanceof Error) {
      console.error('RabbitMQ 配置无效:', error.message);
    }
    throw error;
  }
}
```

## 2. 多节点/集群地址静态配置

多个 URL 传给同一个客户端。地址列表用于连接管理器选择节点和故障恢复：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

@Module({
  imports: [
    RabbitMQModule.forRoot({
      urls: [
        'amqp://app:secret@rabbit-1.internal:5672/orders',
        'amqp://app:secret@rabbit-2.internal:5672/orders',
        'amqp://app:secret@rabbit-3.internal:5672/orders',
      ],
      managerOptions: {
        heartbeatIntervalInSeconds: 10,
        reconnectTimeInSeconds: 5,
      },
    }),
  ],
})
export class AppModule {}
```

`managerOptions` 接受 `amqp-connection-manager` 的连接管理参数，例如 heartbeat、重连间隔和动态服务发现 `findServers`。TLS/socket 选项可放在 `connectionOptions`；更细的 per-node 连接参数可按 `amqp-connection-manager` 支持的 URL 对象传入 `urls` 数组。

## 3. 从外部参数异步配置

通过 `forRootAsync()` 注入 ConfigService，在工厂函数中读取环境配置。下面的配置使用单个默认客户端：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        urls: config.getOrThrow<string>('RABBITMQ_URL'),
        managerOptions: {
          heartbeatIntervalInSeconds: config.get<number>('RABBITMQ_HEARTBEAT', 10),
          reconnectTimeInSeconds: config.get<number>('RABBITMQ_RECONNECT_SECONDS', 5),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

异步工厂可返回 Promise：

```ts
RabbitMQModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const secret = await loadRabbitCredential(config.getOrThrow('SECRET_KEY_ID'));
    return { urls: `amqp://${secret.username}:${secret.password}@${config.getOrThrow('RABBITMQ_HOST')}:5672` };
  },
});
```

上例中的 `loadRabbitCredential` 是应用自身的密钥读取函数，不属于本包。

异步工厂也可以分别返回 `host`、`port`、`user`、`password`，不必组装 URL：

```ts
RabbitMQModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    host: config.getOrThrow<string>('RABBITMQ_HOST'),
    port: config.get<number>('RABBITMQ_PORT', 5672),
    user: config.getOrThrow<string>('RABBITMQ_USER'),
    password: config.getOrThrow<string>('RABBITMQ_PASSWORD'),
    vhost: config.get<string>('RABBITMQ_VHOST', '/'),
  }),
});
```

## 4. 同一应用配置发布者和订阅者

静态配置中通过 `clients` 定义多个客户端。每个名字对应独立连接，可分别使用不同 Broker、虚拟主机或连接参数：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

@Module({
  imports: [
    RabbitMQModule.forRoot({
      clients: {
        publisher: {
          urls: ['amqp://publisher:secret@rabbit-1:5672/events', 'amqp://publisher:secret@rabbit-2:5672/events'],
        },
        subscriber: {
          urls: 'amqp://subscriber:secret@rabbit-1:5672/events',
          managerOptions: { heartbeatIntervalInSeconds: 15 },
        },
      },
    }),
  ],
})
export class AppModule {}
```

异步配置时，`clients` 的 key 就是客户端名，无需重复声明：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@soratani-code/rabbitmq-module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        clients: {
          publisher: { urls: config.getOrThrow<string>('RABBITMQ_PUBLISH_URLS').split(',') },
          subscriber: { urls: config.getOrThrow<string>('RABBITMQ_SUBSCRIBE_URL') },
        },
      }),
    }),
  ],
})
export class AppModule {}
```

## 5. 注入客户端

使用静态客户端配置时，可以通过 `@InjectRabbitMQ()` 注入默认客户端，或传名字注入具名客户端：

```ts
// orders.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRabbitMQ, RabbitMQClient } from '@soratani-code/rabbitmq-module';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRabbitMQ('publisher')
    private readonly publisher: RabbitMQClient,
    @InjectRabbitMQ('subscriber')
    private readonly subscriber: RabbitMQClient,
  ) {}
}
```

异步配置的客户端名称来自工厂结果，应用侧通过注册表按名称获取：

```ts
import { Injectable } from '@nestjs/common';
import { InjectRabbitMQClients, RabbitMQClient, RabbitMQClients } from '@soratani-code/rabbitmq-module';

@Injectable()
export class OrdersService {
  private readonly publisher: RabbitMQClient;

  constructor(@InjectRabbitMQClients() clients: RabbitMQClients) {
    this.publisher = clients.get('publisher');
  }
}
```

`RabbitMQClients` 还提供 `has(name)` 和 `names()`。不存在的客户端名调用 `get(name)` 时会抛出说明明确的错误。静态配置则可直接使用前面的 `@InjectRabbitMQ('publisher')`，也可以使用 Nest 原生 `@Inject(getRabbitMQToken('publisher'))`。

## 6. 发布消息

托管 channel 的 setup 在连接建立和每次重连后执行。在 setup 中声明 exchange/queue/binding，之后使用完整的 channel wrapper 发布消息：

```ts
// events.publisher.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRabbitMQ, RabbitMQClient } from '@soratani-code/rabbitmq-module';
import type { ChannelWrapper } from 'amqp-connection-manager';

@Injectable()
export class EventsPublisher implements OnModuleInit {
  private channel!: ChannelWrapper;

  constructor(@InjectRabbitMQ('publisher') private readonly rabbit: RabbitMQClient) {}

  onModuleInit(): void {
    this.channel = this.rabbit.createChannel({
      setup: async (channel) => {
        await channel.assertExchange('app.events', 'topic', { durable: true });
      },
    });
  }

  async publishOrderCreated(orderId: string): Promise<void> {
    const payload = Buffer.from(JSON.stringify({ orderId, createdAt: new Date().toISOString() }));
    await this.channel.publish('app.events', 'orders.created', payload, {
      contentType: 'application/json',
      persistent: true,
      messageId: orderId,
    });
  }
}
```

## 7. 订阅、确认和拒绝消息

用托管 channel 注册 consumer。setup 回调在重连后重跑，因此 consumer 会在新 channel 上重新注册：

```ts
// orders.consumer.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRabbitMQ, RabbitMQClient } from '@soratani-code/rabbitmq-module';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class OrdersConsumer implements OnModuleInit {
  constructor(@InjectRabbitMQ('subscriber') private readonly rabbit: RabbitMQClient) {}

  onModuleInit(): void {
    this.rabbit.createChannel({
      setup: async (channel) => {
        await channel.assertExchange('app.events', 'topic', { durable: true });
        const queue = await channel.assertQueue('orders.created.worker', { durable: true });
        await channel.bindQueue(queue.queue, 'app.events', 'orders.created');
        await channel.prefetch(10);
        await channel.consume(queue.queue, (message) => {
          if (!message) return; // Broker 取消 consumer 时会收到 null
          void this.handle(channel, message);
        }, { noAck: false });
      },
    });
  }

  private async handle(channel: import('amqplib').Channel, message: ConsumeMessage): Promise<void> {
    try {
      const event = JSON.parse(message.content.toString()) as { orderId: string };
      await this.processOrder(event.orderId);
      channel.ack(message);
    } catch (error) {
      // requeue=false 时消息可通过队列 DLX 配置进入死信队列
      channel.nack(message, false, false);
    }
  }

  private async processOrder(orderId: string): Promise<void> {
    // 在这里调用业务逻辑
    console.log('处理订单', orderId);
  }
}
```

`ack`、`nack`、`reject` 和 `prefetch` 都是原生 AMQP channel 操作。使用 manual ack 时，应仅在业务处理成功后确认消息，并按应用的重试/DLX 策略处理失败消息。

## 8. 使用 RabbitMQ / AMQP 的其他能力

setup 回调收到的是 `amqplib` channel，托管 channel wrapper 也提供发布、发送队列、等待确认、关闭等 channel 方法。以下示例展示队列声明、绑定、拉取、清空和删除等管理操作：

```ts
const channel = rabbit.createChannel({
  setup: async (ch) => {
    await ch.assertExchange('jobs', 'direct', { durable: true, autoDelete: false });
    await ch.assertQueue('jobs.image', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'jobs.dead',
        'x-message-ttl': 60_000,
      },
    });
    await ch.bindQueue('jobs.image', 'jobs', 'image.resize');
  },
});

// sendToQueue / publish 支持 amqplib 的消息属性和选项
await channel.sendToQueue('jobs.image', Buffer.from('resize:123'), {
  persistent: true,
  contentType: 'text/plain',
  headers: { traceId: 'trace-123' },
});

// 需要时也可使用 basic.get 风格的拉取
const result = await channel.get('jobs.image', { noAck: false });
if (result) channel.ack(result);

// 管理操作示例：慎在业务路径中清空或删除队列
// await channel.purgeQueue('jobs.image');
// await channel.deleteQueue('jobs.image');
// await channel.unbindQueue('jobs.image', 'jobs', 'image.resize');
// await channel.deleteExchange('jobs');
```

amqplib 对 RabbitMQ 支持的 channel 操作包含 exchange/queue 声明和管理、binding、publish/sendToQueue、consume/get、ack/nack/reject、prefetch、confirm、transactions、RPC 回复等。具体方法和参数以所用 `amqplib` 版本类型定义及 RabbitMQ 服务端支持为准。

## 9. 原生 channel、发布确认和连接事件

对需要自行管理 channel 生命周期的低层操作，可创建 raw channel。传 `true` 可创建 confirm channel：

```ts
import type { ConfirmChannel } from 'amqplib';

const raw = await rabbit.createRawChannel(true) as ConfirmChannel;
try {
  await raw.assertExchange('payments', 'topic', { durable: true });
  raw.publish('payments', 'payment.received', Buffer.from('{"id":"p-1"}'), { persistent: true });
  await raw.waitForConfirms();
} finally {
  await raw.close();
}
```

raw channel 绑定于当时的底层连接，不会在重连后自动转移；连接断开后应重新创建。需要长期运行的 publisher/consumer 通常使用 `createChannel({ setup })`。

`client.connection` 返回底层 `AmqpConnectionManager`，可监听连接、断开、阻塞状态或主动重连：

```ts
const manager = rabbit.connection;

manager.on('connect', ({ url }) => console.log('RabbitMQ 已连接', url));
manager.on('disconnect', ({ err }) => console.error('RabbitMQ 连接断开', err.message));
manager.on('blocked', ({ reason }) => console.warn('连接被 Broker 阻塞', reason));
manager.on('unblocked', () => console.log('Broker 已解除阻塞'));

// 需要主动触发时：
// manager.reconnect();
// manager.isConnected();
```

## 10. 连接参数和关闭连接

`connectionOptions` 用于 socket/TLS 连接层设置，`managerOptions` 用于 heartbeat、重连等连接管理设置。TLS 证书等配置应配合 `protocol: 'amqps'`；模块会校验 TLS 相关参数与协议是否匹配。也可以对单个具名客户端单独设置：

```ts
RabbitMQModule.forRoot({
  clients: {
    securePublisher: {
      host: 'mq.example.com',
      port: 5671,
      user: 'app',
      password: 'secret',
      protocol: 'amqps',
      vhost: 'app',
      connectionOptions: {
        servername: 'mq.example.com',
        rejectUnauthorized: true,
      },
      managerOptions: {
        heartbeatIntervalInSeconds: 15,
        reconnectTimeInSeconds: 3,
      },
    },
  },
});
```

Nest 会在应用关闭时调用客户端的关闭钩子。若需提前关闭某个客户端：

```ts
await rabbit.close();
```

## 构建和发布

```bash
pnpm install
pnpm build
pnpm publish --access public
```

发布前请在 `package.json` 中设置正确的包名、作者和仓库地址，并确认 npm 包名可用。项目使用 MIT License。
