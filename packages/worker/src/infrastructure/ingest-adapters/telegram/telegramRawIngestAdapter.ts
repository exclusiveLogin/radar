import type {
  IRawIngestAdapter,
  IngestAdapterContext,
  IngestAdapterHealth,
  ChannelHistoryBounds,
  IngestBindingRecord,
  IngestMessageSink,
  IngestNormalizedMessage,
  StreamHistoryParams,
  TelegramAdapterConfig,
} from "@radar/shared";
import { TelegramClient, utils } from "telegram";
import type { Api } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import { NewMessage } from "telegram/events/NewMessage.js";
import { Raw } from "telegram/events/Raw.js";
import { UpdateConnectionState } from "telegram/network/index.js";
import type { SessionResolver } from "../../../application/sessions/sessionResolver.js";
import { ingestConnectionStatus } from "../../../application/ingest/ingestConnectionStatus.js";
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

function isTypeNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TypeNotFoundError" ||
    err.message.includes("Could not find a matching Constructor ID")
  );
}

/** GramJS/Teleproto: TIMEOUT — тихий reconnect; TypeNotFound — устаревший TL layer. */
function wireMtprotoClientErrorHandler(
  client: TelegramClient,
  provider: { id: string; key: string },
): void {
  client.onError = async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "TIMEOUT") {
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "reconnecting",
        detail: "Ping timeout, reconnect…",
      });
      console.warn("[mtproto] ping timeout, reconnecting");
      return;
    }
    if (isTypeNotFoundError(err)) {
      console.error(
        "[mtproto] TypeNotFound — Telegram прислал TL-тип, неизвестный клиенту. " +
          "Проверьте teleproto (npm alias telegram) и что сессия не используется в двух процессах.",
      );
      return;
    }
    console.error("[mtproto]", err);
  };
}

/**
 * События TCP/MTProto для админки.
 * Не откатывать `live` в transitional `connected` — GramJS шлёт connected и после startDuty, и после reconnect.
 */
function wireMtprotoConnectionState(
  client: TelegramClient,
  provider: { id: string; key: string },
): void {
  client.addEventHandler((update) => {
    if (!(update instanceof UpdateConnectionState)) return;

    if (update.state === UpdateConnectionState.connected) {
      // Duty уже идёт — TCP up снова = live; иначе transitional connected.
      if (ingestConnectionStatus.isDutyActive(provider.id)) {
        const current = ingestConnectionStatus.get(provider.id);
        ingestConnectionStatus.set({
          providerId: provider.id,
          providerKey: provider.key,
          phase: "live",
          detail:
            current?.phase === "reconnecting"
              ? "MTProto reconnected, live"
              : (current?.detail ?? "Слушает каналы"),
        });
        return;
      }
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "connected",
        detail: "MTProto connected",
      });
      return;
    }
    if (update.state === UpdateConnectionState.broken) {
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "reconnecting",
        detail: "Соединение прервано, reconnect…",
      });
      return;
    }
    if (update.state === UpdateConnectionState.disconnected) {
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "disconnected",
        detail: "MTProto disconnected",
      });
    }
  }, new Raw({ types: [UpdateConnectionState] }));
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
  /** Последний увиденный message.id per binding — watermark для poll-fallback. */
  private readonly mtprotoLiveWatermark = new Map<string, number>();

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
      // Backfill daemon держит адаптер между тиками — повторный connect не должен рвать TCP.
      if (this.mtproto) {
        try {
          if (await this.mtproto.client.isUserAuthorized()) {
            return;
          }
        } catch {
          /* клиент мёртв — пересоздаём ниже */
        }
        await this.mtproto.client.destroy().catch(() => undefined);
        this.mtproto = null;
      }

      const material = await this.sessionResolver.resolveMaterial(
        creds.mtprotoSessionSlot,
        "mtproto_user",
      );
      const proxy = ctx.resolveMtproxy?.() ?? null;
      ingestConnectionStatus.set({
        providerId: ctx.provider.id,
        providerKey: ctx.provider.key,
        phase: "connecting",
        detail: proxy ? `MTProto via MTProxy ${proxy.ip}:${proxy.port}` : "MTProto direct",
      });
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
      wireMtprotoClientErrorHandler(client, ctx.provider);
      wireMtprotoConnectionState(client, ctx.provider);
      try {
        await client.connect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ingestConnectionStatus.set({
          providerId: ctx.provider.id,
          providerKey: ctx.provider.key,
          phase: "error",
          detail: message,
        });
        throw err;
      }
      ingestConnectionStatus.set({
        providerId: ctx.provider.id,
        providerKey: ctx.provider.key,
        phase: "connected",
        detail: "MTProto session ready",
      });
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

        // getEntity — для poll/getMessages; в NewMessage только peer id (GramJS ломает object → "[object Object]").
        let entity;
        try {
          entity = await client.getEntity(target);
        } catch (err) {
          console.error(`Binding ${binding.bindingKey}: getEntity(${target}) failed:`, err);
          continue;
        }
        const chatPeerId = utils.getPeerId(entity);

        client.addEventHandler(
          async (event) => {
            if (this.dutyAbort?.signal.aborted) return;
            const message = event.message;
            if (!message) return;
            try {
              const normalized = mapTelegramMessage({
                msg: message,
                channelKey,
                providerKey: this.ctx!.provider.key,
                ingestMode: "live",
              });
              await emit(normalized);
            } catch (err) {
              console.error(`[ingest:live:event] ${channelKey}:`, err);
            }
          },
          new NewMessage({ chats: [chatPeerId], incoming: true }),
        );

        console.log(`Live MTProto: ${channelKey} ← ${target} (event + poll ${pollMs}ms)`);

        void this.runMtprotoLivePoll({
          bindingId: binding.id,
          channelKey,
          providerKey: this.ctx.provider.key,
          entity,
          pollMs,
          emit,
        });
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

  /**
   * Poll-fallback для MTProto: getMessages по watermark.
   * Push-updates через MTProxy/каналы не всегда доходят — poll гарантирует live ingest.
   */
  private async runMtprotoLivePoll(input: {
    bindingId: string;
    channelKey: string;
    providerKey: string;
    entity: unknown;
    pollMs: number;
    emit: (msg: IngestNormalizedMessage | null) => Promise<void>;
  }): Promise<void> {
    if (!this.mtproto || !this.dutyAbort) return;
    const { client } = this.mtproto;
    const abort = this.dutyAbort;

    try {
      const latest = await client.getMessages(input.entity as Parameters<typeof client.getMessages>[0], { limit: 1 });
      const topId = latest[0]?.id;
      if (typeof topId === "number") {
        this.mtprotoLiveWatermark.set(input.bindingId, topId);
      }
    } catch (err) {
      console.warn(`Live poll bootstrap ${input.channelKey}:`, err);
    }

    while (!abort.signal.aborted) {
      await sleep(input.pollMs);
      if (abort.signal.aborted) break;

      try {
        const watermark = this.mtprotoLiveWatermark.get(input.bindingId) ?? 0;
        const batch = await client.getMessages(input.entity as Parameters<typeof client.getMessages>[0], { limit: 10 });
        const fresh = batch
          .filter((msg) => typeof msg.id === "number" && msg.id > watermark)
          .sort((a, b) => a.id - b.id);

        for (const msg of fresh) {
          const normalized = mapTelegramMessage({
            msg,
            channelKey: input.channelKey,
            providerKey: input.providerKey,
            ingestMode: "live",
          });
          await input.emit(normalized);
          if (typeof msg.id === "number") {
            this.mtprotoLiveWatermark.set(input.bindingId, msg.id);
          }
        }

        const top = batch[0]?.id;
        if (typeof top === "number" && top > watermark && fresh.length === 0) {
          this.mtprotoLiveWatermark.set(input.bindingId, top);
        }
      } catch (err) {
        if (abort.signal.aborted) break;
        const seconds = getFloodWaitSeconds(err);
        if (seconds != null) {
          console.warn(`Live poll FloodWait ${input.channelKey}: ${seconds}s`);
          await sleep(seconds * 1000);
          continue;
        }
        console.warn(`Live poll ${input.channelKey}:`, err);
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
    this.mtprotoLiveWatermark.clear();

    if (this.mtproto) {
      // destroy() останавливает _updateLoop; disconnect() оставляет zombie ping-loop (backfill × N bindings).
      const provider = this.ctx?.provider;
      await this.mtproto.client.destroy();
      this.mtproto = null;
      if (provider) {
        ingestConnectionStatus.set({
          providerId: provider.id,
          providerKey: provider.key,
          phase: "idle",
          detail: null,
        });
      }
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
      
      // sink возвращает { inserted: boolean }, используем это для честной статистики
      const result = await sink(normalized);
      if (result && result.inserted === false) {
        duplicates += 1;
      } else {
        inserted += 1;
      }
    }

    return { inserted, duplicates };
  }

  /**
   * Preflight: min/max message.id и даты границ канала (2 запроса к Telegram).
   */
  async probeChannelBounds(externalTarget: string): Promise<ChannelHistoryBounds> {
    if (!this.mtproto) {
      throw new Error("MTProto client required for probeChannelBounds");
    }

    let oldest: Api.Message | undefined;
    for await (const msg of this.iterMessagesWithFloodRetry(externalTarget, {
      reverse: true,
      limit: 1,
      waitTime: 0,
    })) {
      oldest = msg as Api.Message;
      break;
    }

    const entity = await this.mtproto.client.getEntity(externalTarget);
    const newestBatch = await this.mtproto.client.getMessages(entity, { limit: 1 });
    const newest = newestBatch[0] as Api.Message | undefined;

    if (!oldest?.id || !newest?.id) {
      throw new Error("Канал пуст или недоступен для probe истории");
    }

    const toIso = (unix?: number) =>
      new Date((unix ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    return {
      minId: String(oldest.id),
      maxId: String(newest.id),
      minPostedAt: toIso(oldest.date),
      maxPostedAt: toIso(newest.date),
      probedAt: new Date().toISOString(),
    };
  }

  /**
   * Потоковая выкачка истории: iterMessages + автоматический sleep при FloodWait.
   * По умолчанию reverse=false — от последнего сообщения к старым.
   */
  async streamHistory(
    binding: IngestBindingRecord,
    params: StreamHistoryParams,
    sink: IngestMessageSink,
  ): Promise<{ inserted: number; duplicates: number; streamed: number }> {
    if (!this.mtproto || !this.ctx) {
      throw new Error("MTProto client required for streamHistory");
    }

    // Round-robin backfill: dedup только внутри одного батча, не между тиками демона.
    this.hybridSeen.clear();

    const channelKey = this.channelKeys.get(binding.id);
    if (!channelKey) {
      throw new Error(`Channel key not resolved for binding ${binding.id}`);
    }

    const iterOptions: { reverse: boolean; offsetId?: number; limit?: number; waitTime?: number } = {
      reverse: params.reverse ?? false,
      // Без limit teleproto ставит waitTime=1 и на первом чанке sleep(1 - now_sec) → TimeoutNegativeWarning.
      waitTime: 0,
    };
    if (params.offsetId) {
      iterOptions.offsetId = params.offsetId;
    }
    if (params.limit != null && params.limit > 0) {
      iterOptions.limit = params.limit;
    }

    let inserted = 0;
    let duplicates = 0;
    let streamed = 0;

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
        streamed += 1;
        if (params.limit != null && streamed >= params.limit) break;
        continue;
      }
      this.hybridSeen.add(key);

      const result = await sink(normalized);
      if (result && result.inserted === false) {
        duplicates += 1;
      } else {
        inserted += 1;
      }

      streamed += 1;
      if (params.limit != null && streamed >= params.limit) break;
    }

    return { inserted, duplicates, streamed };
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

  /** Остановка стрима при выходе за нижнюю границу диапазона (зависит от направления). */
  private shouldStopStream(
    normalized: IngestNormalizedMessage,
    params: StreamHistoryParams,
  ): boolean {
    if (params.fromPostedAt && normalized.postedAt < params.fromPostedAt) {
      return true;
    }

    const reverse = params.reverse ?? false;

    if (reverse) {
      if (params.toExternalId) {
        const toId = Number(params.toExternalId);
        if (Number.isFinite(toId) && Number(normalized.externalMessageId) < toId) {
          return true;
        }
      }
      return false;
    }

    if (params.fromExternalId) {
      const fromId = Number(params.fromExternalId);
      if (Number.isFinite(fromId) && Number(normalized.externalMessageId) < fromId) {
        return true;
      }
    }

    return false;
  }

  private async *iterMessagesWithFloodRetry(
    peer: string,
    options: { reverse: boolean; offsetId?: number; limit?: number; waitTime?: number },
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
