#!/usr/bin/env node
// Chiede alla TV LG cosa sta mostrando davvero.
//
// Serve perche' uno screenshot con grim fotografa cio' che il Raspberry
// disegna, non cio' che appare sullo schermo: se la TV e' su un altro
// ingresso, la box "trasmette" ma nessuno la vede.
//
// Esce 0 se la TV e' sull'ingresso atteso, 1 altrimenti (o se irraggiungibile).
// Usage: tv-status.js [appId-atteso]   default: com.webos.app.hdmi2
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const path = require("path");

const DIR = "/home/admin/lg-control";
const atteso = process.argv[2] || "com.webos.app.hdmi2";
const host = process.env.LG_TV_HOST || "192.168.1.57";

const lgtv = require(path.join(DIR, "node_modules/lgtv2"))({
  url: "wss://" + host + ":3001",
  keyFile: path.join(DIR, "lg-key-"),
  timeout: 10000,
  reconnect: 0,
  wsconfig: { rejectUnauthorized: false },
});

const out = (obj, code) => {
  console.log(JSON.stringify(obj));
  try { lgtv.disconnect(); } catch { /* gia' chiusa */ }
  process.exit(code);
};

// TV spenta o staccata dalla rete: la connessione non si apre proprio.
const timer = setTimeout(() => out({ tv: "irraggiungibile", atteso, ok: false }, 1), 12000);

lgtv.on("error", (e) => {
  clearTimeout(timer);
  out({ tv: "errore", errore: (e && e.message) || String(e), atteso, ok: false }, 1);
});

// Volume TV sotto il quale il programma non si sente in una stanza normale.
const VOLUME_MINIMO = Number(process.env.LG_VOLUME_MINIMO || 8);

lgtv.on("connect", () => {
  lgtv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", (err, res) => {
    if (err || !res) {
      clearTimeout(timer);
      return out({ tv: "accesa", errore: String(err || "nessuna risposta"), atteso, ok: false }, 1);
    }
    const attivo = res.appId || res.windowId || "sconosciuto";
    const ingressoOk = attivo === atteso;

    // L'ingresso giusto non basta: se la TV e' mutata non si sente comunque.
    lgtv.request("ssap://audio/getStatus", (err2, audio) => {
      clearTimeout(timer);
      const vol = audio && typeof audio.volume === "number" ? audio.volume : null;
      const muto = audio ? audio.mute === true : null;
      const audioOk = muto === false && vol !== null && vol >= VOLUME_MINIMO;

      out({
        tv: "accesa",
        mostra: attivo,
        atteso,
        descrizione: descrivi(attivo),
        ingresso_ok: ingressoOk,
        volume: vol,
        muto,
        audio_ok: audioOk,
        ok: ingressoOk && audioOk,
      }, ingressoOk && audioOk ? 0 : 1);
    });
  });
});

function descrivi(appId) {
  if (!appId) return "niente";
  if (appId.startsWith("com.webos.app.hdmi")) return "ingresso HDMI " + appId.slice(-1);
  if (appId === "com.webos.app.livetv") return "canali TV";
  if (appId === "com.webos.app.home") return "schermata home";
  return appId;
}
