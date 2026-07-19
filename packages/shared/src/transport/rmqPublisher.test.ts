import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmChannel } from "amqplib";
import {
  publishConfirmed,
  publishWithConfirmRetry,
  RMQ_PUBLISH_MAX_ATTEMPTS,
  RmqPublishError,
  waitForPublishConfirm,
} from "./rmqPublisher.js";

test("publishConfirmed retries the same persistent JSON message", async () => {
  const body = Buffer.from('{"event":"created"}');
  const calls: Array<{
    exchange: string;
    routingKey: string;
    body: Buffer;
    options: unknown;
  }> = [];
  let attempts = 0;
  const channel = {
    publish(exchange: string, routingKey: string, publishedBody: Buffer, options: unknown, confirm: (error: unknown) => void) {
      calls.push({ exchange, routingKey, body: publishedBody, options });
      attempts += 1;
      confirm(attempts === 1 ? new Error("nack") : null);
      return true;
    },
  } as unknown as ConfirmChannel;

  await publishConfirmed(channel, "radar.events", "event.created", body);

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.exchange === "radar.events"));
  assert.ok(calls.every((call) => call.routingKey === "event.created"));
  assert.ok(calls.every((call) => call.body === body));
  assert.deepEqual(calls[0]?.options, { persistent: true, contentType: "application/json" });
});

test("publishWithConfirmRetry resolves after broker confirm", async () => {
  let attempts = 0;

  await publishWithConfirmRetry(() =>
    waitForPublishConfirm((confirm) => {
      attempts += 1;
      confirm(null);
    }),
  );

  assert.equal(attempts, 1);
});

test("publishWithConfirmRetry retries an unconfirmed publish", async () => {
  let attempts = 0;

  await publishWithConfirmRetry(() =>
    waitForPublishConfirm((confirm) => {
      attempts += 1;
      confirm(attempts === 1 ? new Error("nack") : null);
    }),
  );

  assert.equal(attempts, 2);
});

test("publishWithConfirmRetry rejects after all publish attempts", async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      publishWithConfirmRetry(() =>
        waitForPublishConfirm((confirm) => {
          attempts += 1;
          confirm(new Error("nack"));
        }),
      ),
    (error: unknown) =>
      error instanceof RmqPublishError
      && error.message === `RabbitMQ publish was not confirmed after ${RMQ_PUBLISH_MAX_ATTEMPTS} attempts`,
  );

  assert.equal(attempts, RMQ_PUBLISH_MAX_ATTEMPTS);
});
