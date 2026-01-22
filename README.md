# OnesiBox Client

**Sistema di Assistenza Remota per Persone Anziane**

[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi-red)](https://www.raspberrypi.com/)
[![License](https://img.shields.io/badge/License-ISC-blue)](LICENSE)

---

## Panoramica

**OnesiBox Client** è l'applicazione che gira sulle appliance Raspberry Pi installate presso le persone assistite. Riceve comandi dal server [Onesiforo Web](https://github.com/onesiphorus-team/onesiforo-web) e li esegue localmente, permettendo la riproduzione di contenuti multimediali, la partecipazione a videochiamate e altre funzionalità di assistenza.

Il nome deriva da Onesiforo, cristiano del I secolo che si distinse per la premura mostrata verso l'apostolo Paolo durante la sua prigionia a Roma (2 Timoteo 1:16-17).

## Caratteristiche Principali

- **Riproduzione multimediale** da JW.org (audio e video in streaming)
- **Partecipazione automatica** a riunioni Zoom
- **Controlli playback** (pausa, resume, volume)
- **Monitoraggio remoto** dello stato del dispositivo (CPU, RAM, temperatura)
- **Auto-riparazione** con recovery automatico da errori
- **Zero interazione** richiesta dall'utente finale

## Quick Start

### Prerequisiti

- Node.js 20 LTS
- Git

### Installazione Sviluppo

```bash
# Clona il repository
git clone https://github.com/onesiphorus-team/onesibox-client.git
cd onesibox-client

# Installa le dipendenze
npm install

# Configura
cp config/config.json.example config/config.json
# Modifica config.json con i tuoi valori

# Avvia in modalità sviluppo
npm run dev
```

### Esegui Test

```bash
npm test
```

## Architettura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OnesiBox Client                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │   Browser    │  │    State     │  │     Communication          │ │
│  │  Controller  │  │   Manager    │  │  (Polling + Heartbeat)     │ │
│  │  (Chromium)  │  │ (EventBased) │  │     (axios + retry)        │ │
│  └──────────────┘  └──────────────┘  └────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Command Handlers                           │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │   │
│  │  │ Media   │  │  Zoom   │  │ Volume  │  │    Validator    │  │   │
│  │  │ Handler │  │ Handler │  │ Handler │  │ (URL Whitelist) │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                      Node.js 20 + Raspberry Pi OS                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                         ┌─────────────────┐
                         │  Onesiforo Web  │
                         │    (Server)     │
                         └─────────────────┘
```

## Struttura Progetto

```
onesibox-client/
├── src/                          # Codice sorgente backend
│   ├── main.js                   # Entry point + HTTP server
│   ├── browser/                  # Controllo Chromium
│   │   └── controller.js
│   ├── commands/                 # Gestione comandi
│   │   ├── manager.js            # Dispatcher con priorità
│   │   ├── validator.js          # Validazione URL/payload
│   │   └── handlers/
│   │       ├── media.js          # play/stop/pause/resume
│   │       ├── zoom.js           # join/leave
│   │       └── volume.js         # set_volume
│   ├── communication/            # Client API
│   │   ├── api-client.js         # HTTP client con auth
│   │   ├── polling.js            # Polling con backoff
│   │   └── heartbeat.js          # Metriche sistema
│   ├── config/
│   │   └── config.js             # Loader configurazione
│   ├── logging/
│   │   └── logger.js             # Winston con rotation
│   └── state/
│       └── state-manager.js      # State machine
├── web/                          # Frontend standby screen
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scripts/                      # Script deployment
│   ├── setup.sh                  # Setup Raspberry Pi
│   ├── start-kiosk.sh            # Avvio Chromium
│   └── onesibox.service          # Servizio systemd
├── tests/                        # Test suite
│   ├── unit/
│   └── integration/
├── config/                       # Configurazione
│   └── config.json.example
└── docs/                         # Documentazione
```

## Comandi Supportati

| Comando | Priorità | Descrizione |
|---------|----------|-------------|
| `join_zoom` | 1 (alta) | Partecipa a riunione Zoom |
| `leave_zoom` | 1 (alta) | Lascia riunione Zoom |
| `play_media` | 2 (media) | Riproduce video/audio da JW.org |
| `stop_media` | 2 (media) | Interrompe la riproduzione |
| `pause_media` | 2 (media) | Mette in pausa |
| `resume_media` | 2 (media) | Riprende la riproduzione |
| `set_volume` | 3 (bassa) | Regola il volume (0-100) |

## Configurazione

Il file `config/config.json`:

```json
{
  "server_url": "https://onesiforo.example.com",
  "appliance_id": "your-uuid-here",
  "appliance_token": "your-token-here",
  "polling_interval_seconds": 5,
  "heartbeat_interval_seconds": 30,
  "default_volume": 80
}
```

| Campo | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `server_url` | string | (required) | URL HTTPS del server Onesiforo |
| `appliance_id` | UUID | (required) | ID univoco del dispositivo |
| `appliance_token` | string | (required) | Token di autenticazione |
| `polling_interval_seconds` | int | 5 | Intervallo polling in secondi |
| `heartbeat_interval_seconds` | int | 30 | Intervallo heartbeat in secondi |
| `default_volume` | int | 80 | Volume iniziale (0-100) |

## Hardware Supportato

| Componente | Specifica |
|------------|-----------|
| **Unità centrale** | Raspberry Pi 5 (4GB RAM) o Pi 4 |
| **Storage** | microSD 32GB classe A2 |
| **Display** | Schermo/TV HDMI |
| **Audio** | Casse USB o HDMI |
| **Camera** | Webcam USB con microfono (es. Logitech C920) |
| **Rete** | Ethernet o WiFi |

## Documentazione

La documentazione completa è disponibile nella cartella `/docs`:

| Documento | Descrizione |
|-----------|-------------|
| [Guida Sviluppatore](docs/guida-sviluppatore.md) | Setup ambiente, come contribuire, convenzioni |
| [Architettura Implementazione](docs/architettura-implementazione.md) | Architettura dettagliata con diagrammi Mermaid |
| [Architettura Client](docs/architettura-client.md) | Panoramica architetturale e decisioni |
| [Requisiti](docs/requisiti-client.md) | Requisiti funzionali e non funzionali |

### Per Nuovi Sviluppatori

1. Leggi la [Guida Sviluppatore](docs/guida-sviluppatore.md)
2. Studia l'[Architettura Implementazione](docs/architettura-implementazione.md)
3. Esplora il codice seguendo i diagrammi di sequenza
4. Esegui i test e fai debug di un ciclo polling

## Deploy su Raspberry Pi

### Setup Automatico

```bash
# Sul Raspberry Pi
sudo ./scripts/setup.sh
```

### Verifica Deployment

```bash
# Stato servizio
sudo systemctl status onesibox

# Log applicazione
journalctl -u onesibox -f

# Test endpoint locale
curl http://localhost:3000/api/status
```

## Stack Tecnologico

| Categoria | Tecnologia | Versione |
|-----------|------------|----------|
| **Runtime** | Node.js | 20 LTS |
| **HTTP Client** | axios | ^1.x |
| **Logging** | winston | ^3.x |
| **Metriche** | systeminformation | ^5.x |
| **Testing** | Jest | ^30.x |
| **Linting** | ESLint | ^9.x |
| **Browser** | Chromium | 120+ |
| **OS** | Raspberry Pi OS Lite 64-bit | Bookworm |

## Sicurezza

- **Comunicazioni**: HTTPS/TLS per tutte le richieste
- **Autenticazione**: Token Bearer univoco per appliance
- **URL Whitelist**: Solo domini JW.org autorizzati
- **Validazione**: Input sanitization su tutti i comandi
- **Permessi**: Esecuzione come utente non-root

### Domini Autorizzati

```
jw.org, www.jw.org, wol.jw.org
*.jw-cdn.org
download-a.akamaihd.net
zoom.us, *.zoom.us
```

## Resilienza

- **Backoff esponenziale**: 5s → 10s → 20s → 60s (max)
- **Auto-recovery**: Da stato errore dopo 10 secondi
- **systemd watchdog**: Restart automatico in caso di crash o freeze
- **Log rotation**: 50MB max, 7 giorni retention

### Systemd Auto-Restart

Il servizio è configurato per riavviarsi automaticamente in caso di crash:

```ini
[Service]
Type=simple
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
```

**Protezioni attive:**

| Parametro | Valore | Descrizione |
|-----------|--------|-------------|
| `Restart` | always | Riavvia sempre in caso di crash |
| `RestartSec` | 10s | Attesa prima del riavvio |
| `StartLimitBurst` | 5 | Max 5 riavvii... |
| `StartLimitIntervalSec` | 300s | ...in 5 minuti |

**Verifica stato servizio:**

```bash
# Stato completo
sudo systemctl status onesibox

# Log dei riavvii
journalctl -u onesibox | grep -E "(Started|Stopped)"

# Seguire i log in tempo reale
journalctl -u onesibox -f
```

## Script NPM

| Comando | Descrizione |
|---------|-------------|
| `npm start` | Avvia in produzione |
| `npm run dev` | Avvia in sviluppo (con console log) |
| `npm test` | Esegue tutti i test |
| `npm run test:watch` | Test in watch mode |
| `npm run lint` | Verifica codice con ESLint |

## Contribuire

1. Fork del repository
2. Crea un branch feature (`git checkout -b feature/nuova-funzionalita`)
3. Leggi la [Guida Sviluppatore](docs/guida-sviluppatore.md)
4. Implementa con test
5. Commit (`git commit -m 'Aggiunge nuova funzionalita'`)
6. Push (`git push origin feature/nuova-funzionalita`)
7. Apri Pull Request

## Roadmap

- [x] **Fase 1 - MVP**: Polling HTTP, Media playback, Zoom join
- [ ] **Fase 2**: WebSocket real-time, Playwright per Zoom automation
- [ ] **Fase 3**: Jitsi Meet, TTS, Screenshot remoto
- [ ] **Fase 4**: OTA Updates, Dashboard locale

## License

ISC License - vedere [LICENSE](LICENSE) per dettagli.

---

**Onesiphorus Team** - *"Per la premura mostrata"*
