type BotCommand = "/stats" | "/alerts" | "/errors" | "/sync" | "/health";
const supportedCommands: BotCommand[] = [
  "/stats",
  "/alerts",
  "/errors",
  "/sync",
  "/health",
];

type HldSkeleton = {
  commands: BotCommand[];
  outboxSubscription: {
    mode: "poll" | "listen_notify";
    table: "event_outbox";
    checkpointTable: "state_event_subscription";
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
  commands: supportedCommands,
  outboxSubscription: {
    mode: "poll",
    table: "event_outbox",
    checkpointTable: "state_event_subscription",
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
