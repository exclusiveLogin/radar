import amqp, { type ConfirmChannel, type ConsumeMessage } from "amqplib";
import {
  createCompositeTransportDedup,
  createLruTransportDedup,
  publishConfirmed,
  rmqQueueName,
  type DeploymentTransportRmq,
  type DomainEvent,
  type IEventTransport,
  type ITransportDedup,
  type RadarTopicRoutingKey,
  type TransportDelivery,
  type TransportEventHandler,
  type TransportSignalHandler,
  type TransportSubscribeOptions,
  type Unsubscribe,
} from "@radar/shared";

type AmqpConn = Awaited<ReturnType<typeof amqp.connect>>;

const DLX = "radar.dlx";
const SHUTDOWN_DRAIN_MS = 30_000;

type PendingSub = {
  routingKey: RadarTopicRoutingKey;
  kind: "unit" | "signal";
  handler: TransportEventHandler | TransportSignalHandler;
  queueSuffix: string;
  delivery: TransportDelivery;
};

type ActiveConsumer = {
  groupKey: string;
  tag: string;
};

export type RmqEventTransportOptions = {
  cfg: DeploymentTransportRmq;
  /** Суффикс consumer-очереди по умолчанию (role). Override через TransportSubscribeOptions. */
  consumerQueueSuffix: string;
  /** PG + LRU composite; если не передан — LRU only при dedupTable. */
  dedup?: ITransportDedup;
  /** Потеря соединения фатальна: внешний runtime завершает процесс для supervisor-restart. */
  onConnectionLost?: (error: Error) => void;
};

/** RabbitMQ transport — topic exchange + per-role queues + graceful shutdown. */
export class RmqEventTransport implements IEventTransport {
  private connection: AmqpConn | null = null;
  private channel: ConfirmChannel | null = null;
  private readonly subs: PendingSub[] = [];
  private readonly consumers: ActiveConsumer[] = [];
  /** Одна physical consume на (routingKey, queueSuffix, kind) → fan-out handlers в процессе. */
  private readonly activeGroups = new Set<string>();
  private readonly dedup: ITransportDedup | null;
  private readonly consumerQueueSuffix: string;
  private inFlight = 0;
  private stopping = false;
  private started = false;
  private connectionLossReported = false;
  private readonly cfg: DeploymentTransportRmq;
  private readonly onConnectionLost?: (error: Error) => void;

  constructor(options: RmqEventTransportOptions) {
    this.cfg = options.cfg;
    this.consumerQueueSuffix = options.consumerQueueSuffix;
    this.onConnectionLost = options.onConnectionLost;
    if (options.dedup) {
      this.dedup = options.dedup;
    } else if (options.cfg.dedupTable) {
      this.dedup = createLruTransportDedup();
    } else {
      this.dedup = null;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.stopping = false;
    this.connection = await amqp.connect(this.cfg.url);
    this.channel = await this.connection.createConfirmChannel();
    this.watchConnection(this.connection, this.channel);
    await this.channel.prefetch(this.cfg.prefetch);
    await this.channel.assertExchange(this.cfg.exchange, "topic", { durable: true });
    await this.channel.assertExchange(DLX, "topic", { durable: true });
    for (const sub of this.subs) await this.ensureConsumerGroup(sub);
    this.started = true;
  }

  /** Cancel consumers → drain in-flight handlers → close channel/connection. */
  async stop(): Promise<void> {
    if (!this.started && !this.channel) return;
    this.stopping = true;
    const ch = this.channel;
    for (const consumer of [...this.consumers]) {
      try {
        await ch?.cancel(consumer.tag);
      } catch {
        /* channel may already be closing */
      }
    }
    this.consumers.length = 0;
    this.activeGroups.clear();

    const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    await ch?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = null;
    this.connection = null;
    this.started = false;
    this.connectionLossReported = false;
    this.stopping = false;
  }

  subscribe(
    routingKey: RadarTopicRoutingKey,
    handler: TransportEventHandler,
    options?: TransportSubscribeOptions,
  ): Unsubscribe {
    return this.addSub({
      routingKey,
      kind: "unit",
      handler,
      queueSuffix: options?.queueSuffix ?? this.consumerQueueSuffix,
      delivery: options?.delivery ?? "reliable",
    });
  }

  subscribeSignal(
    routingKey: RadarTopicRoutingKey,
    handler: TransportSignalHandler,
    options?: TransportSubscribeOptions,
  ): Unsubscribe {
    return this.addSub({
      routingKey,
      kind: "signal",
      handler,
      queueSuffix: options?.queueSuffix ?? this.consumerQueueSuffix,
      delivery: options?.delivery ?? "reliable",
    });
  }

  async publish(routingKey: RadarTopicRoutingKey, events: DomainEvent[]): Promise<void> {
    const body = Buffer.from(JSON.stringify({ kind: "unit", events }));
    await publishConfirmed(this.requireChannel(), this.cfg.exchange, routingKey, body);
  }

  async publishSignal(routingKey: RadarTopicRoutingKey, payload: Record<string, unknown>): Promise<void> {
    const body = Buffer.from(JSON.stringify({ kind: "signal", payload }));
    await publishConfirmed(this.requireChannel(), this.cfg.exchange, routingKey, body);
  }

  private addSub(sub: PendingSub): Unsubscribe {
    this.subs.push(sub);
    if (this.started && this.channel && !this.stopping) void this.ensureConsumerGroup(sub);
    return () => {
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  private requireChannel(): ConfirmChannel {
    if (!this.channel) throw new Error("RmqEventTransport not started");
    return this.channel;
  }

  private groupKey(
    sub: Pick<PendingSub, "routingKey" | "queueSuffix" | "kind" | "delivery">,
  ): string {
    return `${sub.routingKey}|${sub.queueSuffix}|${sub.kind}|${sub.delivery}`;
  }

  private async ensureQueueTopology(
    ch: ConfirmChannel,
    routingKey: RadarTopicRoutingKey,
    queueSuffix: string,
    delivery: TransportDelivery,
  ): Promise<string> {
    const q = rmqQueueName(routingKey, queueSuffix);
    if (delivery === "transient") {
      const transient = await ch.assertQueue("", {
        durable: false,
        exclusive: true,
        autoDelete: true,
      });
      await ch.bindQueue(transient.queue, this.cfg.exchange, routingKey);
      return transient.queue;
    }

    const dlq = `${q}.dlq`;
    await ch.assertQueue(dlq, { durable: true });
    await ch.assertQueue(q, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX,
        "x-dead-letter-routing-key": dlq,
      },
    });
    await ch.bindQueue(q, this.cfg.exchange, routingKey);
    await ch.bindQueue(dlq, DLX, dlq);
    // Split-role: orphan `*.monolith` (0 consumers) — удалить, если никто не слушает.
    if (this.consumerQueueSuffix !== "monolith" && queueSuffix !== "monolith") {
      try {
        await ch.deleteQueue(rmqQueueName(routingKey, "monolith"), {
          ifUnused: true,
          ifEmpty: false,
        });
      } catch {
        /* очередь может отсутствовать */
      }
    }
    return q;
  }

  /** Один AMQP consumer на группу; все handlers с тем же suffix multiplex'ятся. */
  private async ensureConsumerGroup(sub: PendingSub): Promise<void> {
    if (this.stopping) return;
    const key = this.groupKey(sub);
    if (this.activeGroups.has(key)) return;
    // Резервируем ключ до await — иначе parallel subscribe плодит competing consumers.
    this.activeGroups.add(key);

    try {
      const ch = this.requireChannel();
      const q = await this.ensureQueueTopology(
        ch,
        sub.routingKey,
        sub.queueSuffix,
        sub.delivery,
      );
      const { consumerTag } = await ch.consume(
        q,
        (msg) => void this.onGroupMessage(key, sub.delivery, msg),
        { noAck: sub.delivery === "transient" },
      );
      this.consumers.push({ groupKey: key, tag: consumerTag });
    } catch (err) {
      this.activeGroups.delete(key);
      throw err;
    }
  }

  private async onGroupMessage(
    groupKey: string,
    delivery: TransportDelivery,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    const reliable = delivery === "reliable";
    if (!msg || !this.channel || this.stopping) {
      if (reliable && msg && this.channel) this.channel.nack(msg, false, true);
      return;
    }
    this.inFlight += 1;
    try {
      const parsed = JSON.parse(msg.content.toString("utf8")) as
        | { kind: "unit"; events: DomainEvent[] }
        | { kind: "signal"; payload: Record<string, unknown> };

      const matching = this.subs.filter((s) => this.groupKey(s) === groupKey);
      if (parsed.kind === "unit") {
        for (const event of parsed.events) {
          if (this.dedup && !(await this.dedup.tryClaim(`${groupKey}:${event.id}`))) continue;
          for (const sub of matching) {
            if (sub.kind !== "unit") continue;
            await (sub.handler as TransportEventHandler)(event);
          }
        }
      } else if (parsed.kind === "signal") {
        for (const sub of matching) {
          if (sub.kind !== "signal") continue;
          await (sub.handler as TransportSignalHandler)(parsed.payload);
        }
      }
      if (reliable) this.channel.ack(msg);
    } catch (err) {
      console.error(`[rmq] consume failed ${groupKey}`, err);
      if (reliable) this.channel.nack(msg, false, false);
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Соединение без встроенного reconnect: сообщаем runtime, чтобы supervisor поднял worker заново. */
  private watchConnection(connection: AmqpConn, channel: ConfirmChannel): void {
    const report = (error: Error) => {
      if (this.stopping || this.connectionLossReported) return;
      this.connectionLossReported = true;
      this.onConnectionLost?.(error);
    };
    connection.once("error", report);
    connection.once("close", () => report(new Error("RabbitMQ connection closed")));
    channel.once("error", report);
  }
}

/** Factory: LRU L1 + optional PG L2. */
export function createRmqEventTransport(
  cfg: DeploymentTransportRmq,
  pgDedup?: ITransportDedup,
  consumerQueueSuffix = "default",
  onConnectionLost?: (error: Error) => void,
): RmqEventTransport {
  const dedup = cfg.dedupTable
    ? createCompositeTransportDedup(createLruTransportDedup(), pgDedup)
    : undefined;
  return new RmqEventTransport({ cfg, dedup, consumerQueueSuffix, onConnectionLost });
}
