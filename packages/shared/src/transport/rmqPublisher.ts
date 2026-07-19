import type { ConfirmChannel } from "amqplib";

/** Число публикаций одного сообщения, включая первую попытку. */
export const RMQ_PUBLISH_MAX_ATTEMPTS = 3;

const RMQ_PUBLISH_RETRY_DELAY_MS = 20;
const RMQ_PUBLISH_OPTIONS = { persistent: true, contentType: "application/json" };

export type RmqPublishConfirm = (error: unknown) => void;

/** Брокер не подтвердил публикацию в отведённое число попыток. */
export class RmqPublishError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`RabbitMQ publish was not confirmed after ${RMQ_PUBLISH_MAX_ATTEMPTS} attempts`);
    this.name = "RmqPublishError";
    this.cause = cause;
  }
}

/** Преобразует callback amqplib publisher confirm в Promise. */
export function waitForPublishConfirm(publish: (confirm: RmqPublishConfirm) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    publish((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Публикует JSON-сообщение через confirm channel и повторяет попытку при nack.
 * Все попытки используют один и тот же буфер и неизменяемые AMQP-атрибуты.
 */
export async function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  body: Buffer,
): Promise<void> {
  await publishWithConfirmRetry(() =>
    waitForPublishConfirm((confirm) => {
      channel.publish(exchange, routingKey, body, RMQ_PUBLISH_OPTIONS, confirm);
    }),
  );
}

/**
 * Повторяет подтверждённую публикацию с ограниченным числом попыток.
 * Вызывающий код хранит сериализованное сообщение вне callback, поэтому каждая
 * попытка передаёт брокеру ту же полезную нагрузку и сохраняет identity событий.
 */
export async function publishWithConfirmRetry(publish: () => Promise<void>): Promise<void> {
  let cause: unknown;

  for (let attempt = 1; attempt <= RMQ_PUBLISH_MAX_ATTEMPTS; attempt += 1) {
    try {
      await publish();
      return;
    } catch (error) {
      cause = error;
      if (attempt < RMQ_PUBLISH_MAX_ATTEMPTS) await sleep(RMQ_PUBLISH_RETRY_DELAY_MS);
    }
  }

  throw new RmqPublishError(cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
