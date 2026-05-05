type BotCommand = "/stats" | "/alerts" | "/errors" | "/sync" | "/health";

type HldSkeleton = {
  commands: BotCommand[];
  outboxSubscription: {
    mode: "poll" | "listen_notify";
    table: "domain_events";
    checkpointTable: "event_subscriptions";
  };
  accessPolicy: {
    envVar: "RADAR_ADMIN_BOT_ALLOWED_USER_IDS";
    strategy: "allowlist";
  };
  integrations: {
    readApi: ["/api/events", "/api/regions", "/api/admin/parse-attempts", "/api/admin/geo-sync"];
  };
};

const skeleton: HldSkeleton = {
  commands: ["/stats", "/alerts", "/errors", "/sync", "/health"],
  outboxSubscription: {
    mode: "poll",
    table: "domain_events",
    checkpointTable: "event_subscriptions",
  },
  accessPolicy: {
    envVar: "RADAR_ADMIN_BOT_ALLOWED_USER_IDS",
    strategy: "allowlist",
  },
  integrations: {
    readApi: [
      "/api/events",
      "/api/regions",
      "/api/admin/parse-attempts",
      "/api/admin/geo-sync",
    ],
  },
};

console.log("[admin-bot:hld] skeleton loaded");
console.log(JSON.stringify(skeleton, null, 2));
console.log("TODO: implement Telegram transport, command handlers, outbox consumer.");
