# OnesiBox Client

**Sistema di Assistenza Remota per Persone Anziane**

---

## Panoramica

**OnesiBox Client** e l'applicazione che gira sulle appliance Raspberry Pi installate presso le persone assistite. Riceve comandi dal server [Onesiforo Web](https://github.com/onesiphorus-team/onesiforo-web) e li esegue localmente, permettendo la riproduzione di contenuti multimediali, la partecipazione a videochiamate e altre funzionalita di assistenza.

Il nome deriva da Onesiforo, cristiano del I secolo che si distinse per la premura mostrata verso l'apostolo Paolo durante la sua prigionia a Roma (2 Timoteo 1:16-17).

## Caratteristiche Principali

- **Riproduzione multimediale** da JW.org (audio e video in streaming)
- **Partecipazione automatica** a riunioni Zoom
- **Videochiamate dirette** tramite Jitsi Meet
- **Text-to-Speech** per messaggi vocali dal caregiver
- **Monitoraggio remoto** dello stato del dispositivo
- **Auto-riparazione** e watchdog per massima affidabilita
- **Zero interazione** richiesta dall'utente finale

## Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                      OnesiBox Client                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Browser   │  │  System     │  │   Communication     │  │
│  │   Engine    │  │  Monitor    │  │   Layer             │  │
│  │  (Chromium) │  │  (Health)   │  │  (Polling/WS)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Raspberry Pi OS Lite                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Onesiforo Web  │
                    │    (Server)     │
                    └─────────────────┘
```

## Hardware Supportato

| Componente | Specifica |
|------------|-----------|
| **Unita centrale** | Raspberry Pi 5 (4GB RAM) |
| **Storage** | microSD 32GB classe A2 |
| **Display** | Schermo/TV HDMI |
| **Audio** | Casse USB o HDMI |
| **Camera** | Webcam USB con microfono (es. Logitech C920) |
| **Rete** | Ethernet o WiFi/LTE |

## Requisiti di Sistema

- Raspberry Pi OS Lite 64-bit (Bookworm o successivo)
- Chromium Browser
- Connessione Internet stabile
- Token di autenticazione dal server Onesiforo

## Installazione

> Documentazione di installazione completa in arrivo

```bash
# Clona il repository
git clone https://github.com/onesiphorus-team/onesibox-client.git
cd onesibox-client

# Esegui lo script di setup
sudo ./scripts/setup.sh

# Configura il token di autenticazione
cp config/config.example.json config/config.json
nano config/config.json
```

## Configurazione

Il file `config/config.json` contiene le impostazioni principali:

```json
{
  "server_url": "https://onesiforo.example.com",
  "appliance_token": "your-token-here",
  "polling_interval": 5,
  "heartbeat_interval": 30,
  "websocket_enabled": true
}
```

## Documentazione

La documentazione tecnica completa e disponibile nella cartella `/docs`:

- [Architettura del Client](docs/architettura-client.md)
- [Requisiti Funzionali e Non Funzionali](docs/requisiti-client.md)
- [Specifiche OnesiBox](docs/OnesiBox_Specifiche.pdf)

## Comandi Supportati

| Comando | Descrizione |
|---------|-------------|
| `play_media` | Riproduce audio/video da JW.org |
| `stop_media` | Interrompe la riproduzione |
| `pause_media` | Mette in pausa |
| `resume_media` | Riprende la riproduzione |
| `set_volume` | Regola il volume |
| `join_zoom` | Avvia riunione Zoom |
| `leave_zoom` | Termina riunione Zoom |
| `start_jitsi` | Avvia videochiamata Jitsi |
| `speak_text` | Sintetizza testo in voce |
| `show_message` | Mostra messaggio a schermo |
| `reboot` | Riavvia il dispositivo |
| `shutdown` | Spegne il dispositivo |
| `start_vnc` | Avvia sessione VNC reverse |

## Stack Tecnologico

| Categoria | Tecnologia | Note |
|-----------|------------|------|
| Runtime | Node.js 20+ / Electron | Valutazione in corso |
| Browser Engine | Chromium | Kiosk mode fullscreen |
| Comunicazione | HTTP Polling / WebSocket | Fase 1 polling, Fase 2 WebSocket |
| TTS | espeak-ng / Web Speech API | Sintesi vocale offline/online |
| Watchdog | systemd + hardware watchdog | Auto-riavvio in caso di blocco |

## Modalita Operative

### Fase 1 - Polling HTTP

L'appliance interroga periodicamente il server per ricevere comandi pendenti.

### Fase 2 - WebSocket

Comunicazione bidirezionale in tempo reale tramite Laravel Reverb.

## Sicurezza

- Comunicazioni cifrate (HTTPS/WSS)
- Token di autenticazione per ogni appliance
- Validazione URL per domini JW.org autorizzati
- Nessun accesso SSH esposto (solo via Cloudflare Tunnel)

## Contribuire

Le contribuzioni sono benvenute. Consultare le linee guida nel repository principale.
