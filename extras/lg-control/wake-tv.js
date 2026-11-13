#!/usr/bin/env node
// Send Wake-on-LAN magic packet to the LG TV.
// MAC source order: $LG_TV_MAC env var, then .tv-mac file in this directory.
const fs = require("fs");
const path = require("path");
const wol = require(path.join(__dirname, "node_modules/wake_on_lan"));
const macFile = path.join(__dirname, ".tv-mac");
const mac = (process.env.LG_TV_MAC || (fs.existsSync(macFile) ? fs.readFileSync(macFile, "utf8") : "")).trim();
if (!mac) { console.error("[wol] no MAC available (set LG_TV_MAC or create .tv-mac)"); process.exit(2); }
wol.wake(mac, { num_packets: 5, interval: 100 }, (err) => {
  if (err) { console.error("[wol] failed:", err.message || err); process.exit(1); }
  console.log("[wol] magic packets sent to " + mac);
});
