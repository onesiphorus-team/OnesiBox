#!/usr/bin/env node
// Usage: lg-switch.js <appId>  es.  com.webos.app.hdmi2 | com.webos.app.livetv
// Host override: LG_TV_HOST env var (default: 192.168.1.48)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const path = require("path");
const appId = process.argv[2];
if (!appId) { console.error("uso: lg-switch.js <appId>"); process.exit(2); }
const host = process.env.LG_TV_HOST || "192.168.1.48";
const lgtv = require(path.join(__dirname, "node_modules/lgtv2"))({
  url: "wss://" + host + ":3001",
  keyFile: path.join(__dirname, "lg-key-"),
  timeout: 15000, reconnect: 0,
  wsconfig: { rejectUnauthorized: false },
});
const bail = (code, msg) => { if (msg) console.log(msg); try{lgtv.disconnect();}catch{} process.exit(code); };
setTimeout(()=>bail(1, "[timeout] nessuna risposta dalla TV " + host + " entro 15s"), 15000);
lgtv.on("error", e => bail(1, "[err] " + ((e && e.message) || e)));
// La chiave in lg-key- non e' stata accettata: la TV mostra a schermo
// la richiesta di autorizzazione e resta in attesa.
lgtv.on("prompt", () => console.log("[prompt] la TV " + host + " chiede di autorizzare la connessione (chiave lg-key- non accettata)"));
lgtv.on("connect", () => {
  lgtv.request("ssap://system.launcher/launch", { id: appId }, (err, res) => {
    if (err || !res || res.returnValue !== true) return bail(1, "[fail] " + (err || JSON.stringify(res)));
    console.log("[ok] " + appId + " @ " + host);
    bail(0);
  });
});
