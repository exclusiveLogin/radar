import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:3000/ws");
let count = { snapshot: 0, "region-state": 0, "place-state": 0, warning: 0 };

ws.on("open", () => console.log("connected"));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  count[msg.type] = (count[msg.type] ?? 0) + 1;
  if (count[msg.type] <= 2) {
    console.log(msg.type, msg.type === "snapshot" ? { regions: msg.payload?.regions?.length, places: msg.payload?.places?.length } : msg.payload);
  }
});
ws.on("error", (e) => console.error("error", e.message));
ws.on("close", () => {
  console.log("counts", count);
  process.exit(0);
});
setTimeout(() => ws.close(), 2500);
