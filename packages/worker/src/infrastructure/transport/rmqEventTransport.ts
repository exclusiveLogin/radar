import amqp, { type Channel, type ConsumeMessage } from "amqplib";
import {
  createCompositeTransportDedup,
  createLruTransportDedup,
  rmqQueueName,
  type DeploymentTransportRmq,
  type DomainEvent,
  type IEventTransport,
  type ITransportDedup,
  type RadarTopicRoutingKey,
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
};

/** RabbitMQ transport — topic exchange + per-role queues + graceful shutdown. */
export class RmqEventTransport implements IEventTransport {
  private connection: AmqpConn | null = null;
  private channel: Channel | null = null;
  private readonly subs: PendingSub[] = [];
  private readonly consumers: ActiveConsumer[] = [];
  /** Одна physical consume на (routingKey, queueSuffix, kind) → fan-out handlers в процессе. */
  private readonly activeGroups = new Set<string>();
  private readonly dedup: ITransportDedup | null;
  private readonly consumerQueueSuffix: string;
  private inFlight = 0;
  private stopping = false;
  private started = false;
  private readonly cfg: DeploymentTransportRmq;

  constructor(options: RmqEventTransportOptions) {
    this.cfg = options.cfg;
    this.consumerQueueSuffix = options.consumerQueueSuffix;
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
    this.channel = await this.connection.createChannel();
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
    });
  }

  async publish(routingKey: RadarTopicRoutingKey, events: DomainEvent[]): Promise<void> {
    const ch = this.requireChannel();
    const body = Buffer.from(JSON.stringify({ kind: "unit", events }));
    ch.publish(this.cfg.exchange, routingKey, body, { persistent: true, contentType: "application/json" });
  }

  async publishSignal(routingKey: RadarTopicRoutingKey, payload: Record<string, unknown>): Promise<void> {
    const ch = this.requireChannel();
    const body = Buffer.from(JSON.stringify({ kind: "signal", payload }));
    ch.publish(this.cfg.exchange, routingKey, body, { persistent: true, contentType: "application/json" });
  }

  private addSub(sub: PendingSub): Unsubscribe {
    this.subs.push(sub);
    if (this.started && this.channel && !this.stopping) void this.ensureConsumerGroup(sub);
    return () => {
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  private requireChannel(): Channel {
    if (!this.channel) throw new Error("RmqEventTransport not started");
    return this.channel;
  }

  private groupKey(sub: Pick<PendingSub, "routingKey" | "queueSuffix" | "kind">): string {
    return `${sub.routingKey}|${sub.queueSuffix}|${sub.kind}`;
  }

  private async ensureQueueTopology(
    ch: Channel,
    routingKey: RadarTopicRoutingKey,
    queueSuffix: string,
  ): Promise<string> {
    const q = rmqQueueName(routingKey, queueSuffix);
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
      const q = await this.ensureQueueTopology(ch, sub.routingKey, sub.queueSuffix);
      const { consumerTag } = await ch.consume(q, (msg) => void this.onGroupMessage(key, msg), {
        noAck: false,
      });
      this.consumers.push({ groupKey: key, tag: consumerTag });
    } catch (err) {
      this.activeGroups.delete(key);
      throw err;
    }
  }

  private async onGroupMessage(groupKey: string, msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel || this.stopping) {
      if (msg && this.channel) this.channel.nack(msg, false, true);
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
      this.channel.ack(msg);
    } catch (err) {
      console.error(`[rmq] consume failed ${groupKey}`, err);
      this.channel.nack(msg, false, false);
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** Factory: LRU L1 + optional PG L2. */
export function createRmqEventTransport(
  cfg: DeploymentTransportRmq,
  pgDedup?: ITransportDedup,
  consumerQueueSuffix = "default",
): RmqEventTransport {
  const dedup = cfg.dedupTable
    ? createCompositeTransportDedup(createLruTransportDedup(), pgDedup)
    : undefined;
  return new RmqEventTransport({ cfg, dedup, consumerQueueSuffix });
}
