import type {
  IRawIngestAdapter,
  IngestAdapterContext,
  IngestAdapterHealth,
  IngestBindingRecord,
  IngestMessageSink,
  IngestNormalizedMessage,
  StreamHistoryParams,
  TelegramAdapterConfig,
} from "@radar/shared";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import { NewMessage } from "telegram/events/NewMessage.js";
import type { SessionResolver } from "../../../application/sessions/sessionResolver.js";
import { mapTelegramBotUpdate, mapTelegramMessage } from "./toRawMessage.js";
import { getFloodWaitSeconds, sleep } from "./telegramFloodWait.js";

type MtprotoClientState = {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
};

type BotPollState = {
  token: string;
  offset: number;
  abort: AbortController;
};

function isMtprotoMode(mode: IngestBindingRecord["bindingMode"]): boolean {
  return (
    mode === "user_mtproto_group" ||
    mode === "user_mtproto_channel" ||
    mode === "hybrid_user_bot_group"
  );
}

function isBotMode(mode: IngestBindingRecord["bindingMode"]): boolean {
  return (
    mode === "bot_api_group" ||
    mode === "bot_api_dm" ||
    mode === "hybrid_user_bot_group"
  );
}

function dedupKey(msg: IngestNormalizedMessage): string {
  return `${msg.channelKey}:${msg.externalMessageId}:${msg.revisionKey ?? ""}`;
}

/**
 * Telegram raw ingest: user MTProto NewMessage, bot getUpdates long-poll, hybrid dedup, MTProxy, history backfill.
 */
export class TelegramRawIngestAdapter implements IRawIngestAdapter {
  readonly kind = "telegram" as const;

  private ctx: IngestAdapterContext | null = null;
  private mtproto: MtprotoClientState | null = null;
  private botPolls = new Map<string, BotPollState>();
  private dutyAbort: AbortController | null = null;
  private readonly hybridSeen = new Set<string>();
  private channelKeys = new Map<string, string>();

  constructor(private readonly sessionResolver: SessionResolver) {}

  async connect(ctx: IngestAdapterContext): Promise<void> {
    this.ctx = ctx;
    const creds = ctx.provider.credentialRefs;
    const app = ctx.telegramMtprotoApp;
    if (!app?.apiId || !app.apiHash) {
      throw new Error(
        "IngestAdapterContext.telegramMtprotoApp не задан (ожидается из composition root)",
      );
    }
    const { apiId, apiHash } = app;

    const needsMtproto = true;
    if (needsMtproto && creds.mtprotoSessionSlot) {
      const material = await this.sessionResolver.resolveMaterial(
        creds.mtprotoSessionSlot,
        "mtproto_user",
      );
      const proxy = ctx.resolveMtproxy?.() ?? null;
      const client = new TelegramClient(
        new StringSession(material.secret),
        apiId,
        apiHash,
        {
          connectionRetries: 5,
          ...(proxy
            ? {
                proxy: {
                  ip: proxy.ip,
                  port: proxy.port,
                  secret: proxy.secret,
                  MTProxy: true,
                },
              }
            : {}),
        },
      );
      await client.connect();
      this.mtproto = { client, apiId, apiHash };
    }
  }

  async startDuty(bindings: IngestBindingRecord[], sink: IngestMessageSink): Promise<void> {
    if (!this.ctx) {
      throw new Error("Telegram adapter not connected");
    }

    this.dutyAbort = new AbortController();
    const pollMs = Number(process.env.RADAR_INGEST_POLL_MS ?? "2000");
    const config = this.ctx.provider.adapterConfig as TelegramAdapterConfig;
    const botPollInterval = config.pollIntervalMs ?? pollMs;

    const emit = async (msg: IngestNormalizedMessage | null) => {
      if (!msg) return;
      const key = dedupKey(msg);
      if (this.hybridSeen.has(key)) return;
      this.hybridSeen.add(key);
      await sink(msg);
    };

    for (const binding of bindings) {
      if (!binding.enabled) continue;
      const channelKey = this.channelKeys.get(binding.id);
      if (!channelKey) continue;

      if (isMtprotoMode(binding.bindingMode) && this.mtproto) {
        const { client } = this.mtproto;
        const target = binding.externalTarget;
        client.addEventHandler(
          async (event) => {
            if (this.dutyAbort?.signal.aborted) return;
            const message = event.message;
            if (!message) return;
            const normalized = mapTelegramMessage({
              msg: message,
              channelKey,
              providerKey: this.ctx!.provider.key,
              ingestMode: "live",
            });
            await emit(normalized);
          },
          new NewMessage({ chats: [target] }),
        );
      }

      if (isBotMode(binding.bindingMode)) {
        const slot = this.ctx.provider.credentialRefs.botTokenSlot;
        if (!slot) {
          console.warn(`Binding ${binding.bindingKey}: botTokenSlot не задан.`);
          continue;
        }
        const material = await this.sessionResolver.resolveMaterial(slot, "bot_token");
        const abort = new AbortController();
        this.botPolls.set(binding.id, { token: material.secret, offset: 0, abort });

        void this.runBotLongPoll({
          bindingId: binding.id,
          channelKey,
          providerKey: this.ctx.provider.key,
          token: material.secret,
          intervalMs: botPollInterval,
          parentAbort: this.dutyAbort,
          emit,
        });
      }
    }
  }

  private async runBotLongPoll(input: {
    bindingId: string;
    channelKey: string;
    providerKey: string;
    token: string;
    intervalMs: number;
    parentAbort: AbortController;
    emit: (msg: IngestNormalizedMessage | null) => Promise<void>;
  }): Promise<void> {
    let offset = this.botPolls.get(input.bindingId)?.offset ?? 0;

    while (!input.parentAbort.signal.aborted) {
      try {
        const url = new URL(`https://api.telegram.org/bot${input.token}/getUpdates`);
        url.searchParams.set("timeout", "25");
        url.searchParams.set("offset", String(offset));

        const res = await fetch(url, { signal: input.parentAbort.signal });
        const body = (await res.json()) as {
          ok?: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              message_id: number;
              chat: { id: number; type?: string };
              date: number;
              edit_date?: number;
              text?: string;
            };
          }>;
        };

        if (!body.ok || !body.result) {
          await sleep(input.intervalMs);
          continue;
        }

        for (const update of body.result) {
          offset = Math.max(offset, update.update_id + 1);
          if (!update.message) continue;
          const normalized = mapTelegramBotUpdate({
            message: update.message,
            channelKey: input.channelKey,
            providerKey: input.providerKey,
            ingestMode: "live",
          });
          await input.emit(normalized);
        }

        const state = this.botPolls.get(input.bindingId);
        if (state) state.offset = offset;
      } catch (err) {
        if (input.parentAbort.signal.aborted) break;
        console.warn("Bot getUpdates error:", err);
        await sleep(input.intervalMs);
      }
    }
  }

  async stop(): Promise<void> {
    this.dutyAbort?.abort();
    this.dutyAbort = null;

    for (const poll of this.botPolls.values()) {
      poll.abort.abort();
    }
    this.botPolls.clear();
    this.hybridSeen.clear();

    if (this.mtproto) {
      await this.mtproto.client.disconnect();
      this.mtproto = null;
    }
  }

  async health(): Promise<IngestAdapterHealth> {
    if (!this.mtproto && this.botPolls.size === 0) {
      return { ok: false, detail: "not_connected" };
    }
    if (this.mtproto && !(await this.mtproto.client.isUserAuthorized())) {
      return { ok: false, detail: "mtproto_unauthorized" };
    }
    return { ok: true };
  }

  async fetchHistoryBatch(
    binding: IngestBindingRecord,
    params: {
      fromPostedAt?: string;
      toPostedAt?: string;
      fromExternalId?: string;
      toExternalId?: string;
      batchSize: number;
    },
    sink: IngestMessageSink,
  ): Promise<{ inserted: number; duplicates: number }> {
    if (!this.mtproto || !this.ctx) {
      throw new Error("MTProto client required for history backfill");
    }

    const channelKey = this.channelKeys.get(binding.id);
    if (!channelKey) {
      throw new Error(`Channel key not resolved for binding ${binding.id}`);
    }

    const entity = await this.mtproto.client.getEntity(binding.externalTarget);
    const offsetId = params.fromExternalId ? Number(params.fromExternalId) : undefined;
    const messages = await this.mtproto.client.getMessages(entity, {
      limit: params.batchSize,
      offsetId,
    });

    let inserted = 0;
    let duplicates = 0;

    for (const msg of messages) {
      const normalized = mapTelegramMessage({
        msg,
        channelKey,
        providerKey: this.ctx.provider.key,
        ingestMode: "backfill",
      });
      if (!normalized) continue;

      if (params.fromPostedAt && normalized.postedAt < params.fromPostedAt) continue;
      if (params.toPostedAt && normalized.postedAt > params.toPostedAt) continue;

      const key = dedupKey(normalized);
      if (this.hybridSeen.has(key)) {
        duplicates += 1;
        continue;
      }
      this.hybridSeen.add(key);
      await sink(normalized);
      inserted += 1;
    }

    return { inserted, duplicates };
  }

  /**
   * Потоковая выкачка истории: iterMessages (reverse) + автоматический sleep при FloodWait.
   */
  async streamHistory(
    binding: IngestBindingRecord,
    params: StreamHistoryParams,
    sink: IngestMessageSink,
  ): Promise<{ inserted: number; duplicates: number }> {
    if (!this.mtproto || !this.ctx) {
      throw new Error("MTProto client required for streamHistory");
    }

    const channelKey = this.channelKeys.get(binding.id);
    if (!channelKey) {
      throw new Error(`Channel key not resolved for binding ${binding.id}`);
    }

    const iterOptions: { reverse: boolean; offsetId?: number } = { reverse: true };
    if (params.offsetId) {
      iterOptions.offsetId = params.offsetId;
    }

    let inserted = 0;
    let duplicates = 0;

    for await (const msg of this.iterMessagesWithFloodRetry(
      binding.externalTarget,
      iterOptions,
    )) {
      const normalized = mapTelegramMessage({
        msg: msg as Parameters<typeof mapTelegramMessage>[0]["msg"],
        channelKey,
        providerKey: this.ctx.provider.key,
        ingestMode: "backfill",
      });
      if (!normalized) continue;

      if (!this.matchesStreamFilters(normalized, params)) {
        if (this.shouldStopStream(normalized, params)) break;
        continue;
      }

      const key = dedupKey(normalized);
      if (this.hybridSeen.has(key)) {
        duplicates += 1;
        continue;
      }
      this.hybridSeen.add(key);
      await sink(normalized);
      inserted += 1;
    }

    return { inserted, duplicates };
  }

  private matchesStreamFilters(
    normalized: IngestNormalizedMessage,
    params: StreamHistoryParams,
  ): boolean {
    if (params.fromPostedAt && normalized.postedAt < params.fromPostedAt) return false;
    if (params.toPostedAt && normalized.postedAt > params.toPostedAt) return false;
    if (params.fromExternalId) {
      const fromId = Number(params.fromExternalId);
      if (Number.isFinite(fromId) && Number(normalized.externalMessageId) > fromId) return false;
    }
    if (params.toExternalId) {
      const toId = Number(params.toExternalId);
      if (Number.isFinite(toId) && Number(normalized.externalMessageId) < toId) return false;
    }
    return true;
  }

  /** При reverse-итерации: вышли за нижнюю границу диапазона дат — дальше только старее. */
  private shouldStopStream(
    normalized: IngestNormalizedMessage,
    params: StreamHistoryParams,
  ): boolean {
    if (params.fromPostedAt && normalized.postedAt < params.fromPostedAt) {
      return true;
    }
    if (params.toExternalId) {
      const toId = Number(params.toExternalId);
      if (Number.isFinite(toId) && Number(normalized.externalMessageId) < toId) {
        return true;
      }
    }
    return false;
  }

  private async *iterMessagesWithFloodRetry(
    peer: string,
    options: { reverse: boolean; offsetId?: number },
  ): AsyncGenerator<unknown> {
    if (!this.mtproto) {
      throw new Error("MTProto client not connected");
    }

    while (true) {
      try {
        for await (const msg of this.mtproto.client.iterMessages(peer, options)) {
          yield msg;
        }
        return;
      } catch (err) {
        const seconds = getFloodWaitSeconds(err);
        if (seconds != null) {
          console.warn(`Telegram FloodWait: sleep ${seconds}s`);
          await sleep(seconds * 1000);
          continue;
        }
        throw err;
      }
    }
  }

  /** Orchestrator передаёт map bindingId → channelKey перед startDuty. */
  setChannelKeyMap(map: Map<string, string>): void {
    this.channelKeys = map;
  }
}
