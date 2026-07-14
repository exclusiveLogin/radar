import amqp, { type Channel, type ConsumeMessage } from "amqplib";
import {
  listRadarTopicRoutingKeys,
  type DeploymentTransportRmq,
  type DomainEvent,
  type IEventTransport,
  type RadarTopicRoutingKey,
  type TransportEventHandler,
  type TransportSignalHandler,
  type Unsubscribe,
} from "@radar/shared";

type AmqpConn = Awaited<ReturnType<typeof amqp.connect>>;

const DLX = "radar.dlx";

type PendingSub = {
  routingKey: RadarTopicRoutingKey;
  kind: "unit" | "signal";
  handler: TransportEventHandler | TransportSignalHandler;
};

/** RabbitMQ transport — topic exchange + per-key queues. */
export class RmqEventTransport implements IEventTransport {
  private connection: AmqpConn | null = null;
  private channel: Channel | null = null;
  private readonly subs: PendingSub[] = [];
  private readonly seenEventIds = new Set<string>();
  private started = false;

  constructor(private readonly cfg: DeploymentTransportRmq) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.connection = await amqp.connect(this.cfg.url);
    this.channel = await this.connection.createChannel();
    await this.channel.prefetch(this.cfg.prefetch);
    await this.channel.assertExchange(this.cfg.exchange, "topic", { durable: true });
    await this.channel.assertExchange(DLX, "topic", { durable: true });
    await this.ensureAllTopicTopology(this.channel);
    for (const sub of this.subs) await this.bindConsumer(sub);
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = null;
    this.connection = null;
    this.started = false;
  }

  subscribe(routingKey: RadarTopicRoutingKey, handler: TransportEventHandler): Unsubscribe {
    const sub: PendingSub = { routingKey, kind: "unit", handler };
    this.subs.push(sub);
    if (this.started && this.channel) void this.bindConsumer(sub);
    return () => {
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  subscribeSignal(routingKey: RadarTopicRoutingKey, handler: TransportSignalHandler): Unsubscribe {
    const sub: PendingSub = { routingKey, kind: "signal", handler };
    this.subs.push(sub);
    if (this.started && this.channel) void this.bindConsumer(sub);
    return () => {
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  async publish(routingKey: RadarTopicRoutingKey, events: DomainEvent[]): Promise<void> {
    const ch = this.requireChannel();
    await this.ensureQueueTopology(ch, routingKey);
    const body = Buffer.from(JSON.stringify({ kind: "unit", events }));
    ch.publish(this.cfg.exchange, routingKey, body, { persistent: true, contentType: "application/json" });
  }

  async publishSignal(routingKey: RadarTopicRoutingKey, payload: Record<string, unknown>): Promise<void> {
    const ch = this.requireChannel();
    await this.ensureQueueTopology(ch, routingKey);
    const body = Buffer.from(JSON.stringify({ kind: "signal", payload }));
    ch.publish(this.cfg.exchange, routingKey, body, { persistent: true, contentType: "application/json" });
  }

  private requireChannel(): Channel {
    if (!this.channel) throw new Error("RmqEventTransport not started");
    return this.channel;
  }

  private queueName(routingKey: RadarTopicRoutingKey): string {
    return routingKey.replace(/\./g, "_");
  }

  /** Producer-side: очередь + binding до publish — backlog ждёт consumer. */
  private async ensureQueueTopology(ch: Channel, routingKey: RadarTopicRoutingKey): Promise<void> {
    const q = this.queueName(routingKey);
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
  }

  private async ensureAllTopicTopology(ch: Channel): Promise<void> {
    for (const routingKey of listRadarTopicRoutingKeys()) {
      await this.ensureQueueTopology(ch, routingKey);
    }
  }

  private async bindConsumer(sub: PendingSub): Promise<void> {
    const ch = this.requireChannel();
    const q = this.queueName(sub.routingKey);
    await this.ensureQueueTopology(ch, sub.routingKey);
    await ch.consume(q, (msg) => void this.onMessage(sub, msg), { noAck: false });
  }

  private async onMessage(sub: PendingSub, msg: ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;
    try {
      const parsed = JSON.parse(msg.content.toString("utf8")) as
        | { kind: "unit"; events: DomainEvent[] }
        | { kind: "signal"; payload: Record<string, unknown> };
      if (parsed.kind === "unit" && sub.kind === "unit") {
        for (const event of parsed.events) {
          if (this.cfg.dedupTable && this.seenEventIds.has(event.id)) continue;
          if (this.cfg.dedupTable) {
            this.seenEventIds.add(event.id);
            if (this.seenEventIds.size > 10_000) this.seenEventIds.clear();
          }
          await (sub.handler as TransportEventHandler)(event);
        }
      } else if (parsed.kind === "signal" && sub.kind === "signal") {
        await (sub.handler as TransportSignalHandler)(parsed.payload);
      }
      this.channel.ack(msg);
    } catch (err) {
      console.error(`[rmq] consume failed ${sub.routingKey}`, err);
      this.channel.nack(msg, false, false);
    }
  }
}