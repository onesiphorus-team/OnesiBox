# Manuale di Installazione OnesiBox

**Sistema di Assistenza Remota per Persone Anziane**

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Cosa ti serve](#2-cosa-ti-serve)
3. [Preparazione del Raspberry Pi](#3-preparazione-del-raspberry-pi)
4. [Registrazione sul Pannello Onesiforo](#4-registrazione-sul-pannello-onesiforo)
5. [Installazione di OnesiBox](#5-installazione-di-onesibox)
6. [Verifica dell'Installazione](#6-verifica-dellinstallazione)
7. [Primo Avvio](#7-primo-avvio)
8. [Risoluzione Problemi](#8-risoluzione-problemi)
9. [Comandi Utili](#9-comandi-utili)
10. [Domande Frequenti](#10-domande-frequenti)

---

## 1. Introduzione

### Cos'è OnesiBox?

OnesiBox è un dispositivo che permette di assistere a distanza persone anziane o con difficoltà tecnologiche. Una volta installato e collegato alla TV, il dispositivo:

- **Riproduce automaticamente** contenuti audio e video da JW.org
- **Partecipa alle riunioni Zoom** senza che l'utente debba fare nulla
- **Si controlla da remoto** tramite il pannello web Onesiforo
- **Non richiede interazione** da parte della persona assistita

Il nome deriva da Onesiforo, cristiano del I secolo noto per la premura mostrata verso l'apostolo Paolo.

### Come funziona?

```
┌──────────────────┐        Internet        ┌──────────────────┐
│                  │◄──────────────────────►│                  │
│  Pannello Web    │                        │    OnesiBox      │
│   (Caregiver)    │    Comandi + Status    │  (Raspberry Pi)  │
│                  │                        │                  │
└──────────────────┘                        └────────┬─────────┘
                                                     │
                                                     │ HDMI
                                                     ▼
                                            ┌──────────────────┐
                                            │        TV        │
                                            │  (Casa anziano)  │
                                            └──────────────────┘
```

Il caregiver (familiare, volontario) accede al pannello web e invia comandi. Il dispositivo OnesiBox li riceve ed esegue, mostrando i contenuti sulla TV.

---

## 2. Cosa ti serve

### Hardware necessario

| Componente | Specifiche | Note |
|------------|------------|------|
| **Raspberry Pi** | Pi 4 (2GB+) o Pi 5 | Consigliato Pi 5 con 4GB |
| **Alimentatore** | USB-C 5V/3A (Pi 4) o 5V/5A (Pi 5) | Usa l'alimentatore ufficiale |
| **Scheda microSD** | 32GB classe A2 | Consigliata SanDisk Extreme |
| **Cavo HDMI** | Micro-HDMI → HDMI (Pi 4) o HDMI standard (Pi 5) | Per collegare alla TV |
| **Webcam USB** | Con microfono integrato | Es: Logitech C920, C270 |
| **Casse audio** | USB o HDMI | La TV può fare da cassa |
| **Cavo Ethernet** | Cat 5e o superiore | Consigliato (più stabile del WiFi) |

### Requisiti di rete

- Connessione internet stabile (minimo 10 Mbps)
- Accesso alla rete locale per configurazione iniziale
- Porte in uscita: 80, 443 (HTTPS)

### Prima di iniziare

Assicurati di avere:

- [ ] Un computer con lettore di schede SD
- [ ] Accesso al pannello Onesiforo (chiedi al tuo amministratore)
- [ ] Circa 30-45 minuti di tempo
- [ ] Accesso fisico alla TV dove verrà installato il dispositivo

---

## 3. Preparazione del Raspberry Pi

### 3.1 Scarica Raspberry Pi Imager

Scarica e installa **Raspberry Pi Imager** dal sito ufficiale:

🔗 https://www.raspberrypi.com/software/

Disponibile per Windows, macOS e Linux.

### 3.2 Prepara la scheda SD

1. **Inserisci** la scheda microSD nel computer

2. **Apri** Raspberry Pi Imager

3. **Clicca** su "Choose Device" e seleziona il tuo modello di Raspberry Pi

4. **Clicca** su "Choose OS" e seleziona:
   ```
   Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)
   ```
   > ⚠️ Scegli la versione **Lite** (senza desktop), non quella con desktop.

5. **Clicca** su "Choose Storage" e seleziona la tua scheda SD

6. **Clicca** sull'icona ⚙️ (ingranaggio) per le impostazioni avanzate:

   **Generale:**
   - ✅ Set hostname: `onesibox`
   - ✅ Set username and password:
     - Username: `pi`
     - Password: (scegli una password sicura e annotala)
   - ✅ Configure wireless LAN (se usi WiFi):
     - SSID: (nome della rete WiFi)
     - Password: (password WiFi)
     - Country: `IT`
   - ✅ Set locale settings:
     - Time zone: `Europe/Rome`
     - Keyboard layout: `it`

   **Services:**
   - ✅ Enable SSH: Use password authentication

7. **Clicca** "Save" e poi "Write"

8. **Attendi** il completamento della scrittura (5-10 minuti)

### 3.3 Primo avvio del Raspberry Pi

1. **Inserisci** la scheda SD nel Raspberry Pi
2. **Collega** il cavo Ethernet (consigliato) o assicurati che il WiFi sia configurato
3. **Collega** l'alimentatore

Il Raspberry Pi si avvierà. Attendi 2-3 minuti per il primo avvio.

### 3.4 Trova l'indirizzo IP

Per connetterti al Raspberry Pi devi conoscere il suo indirizzo IP. Hai diverse opzioni:

**Opzione A - Dal router:**
Accedi al pannello del router e cerca i dispositivi connessi. Cerca "onesibox" o "raspberrypi".

**Opzione B - Con un monitor:**
Collega temporaneamente un monitor e una tastiera, fai login e digita:
```bash
hostname -I
```

**Opzione C - Scansione rete (avanzato):**
```bash
# Su Linux/macOS
ping onesibox.local

# Oppure usa nmap
nmap -sn 192.168.1.0/24
```

### 3.5 Connettiti via SSH

Dal tuo computer, apri un terminale (o PuTTY su Windows) e connettiti:

```bash
ssh pi@INDIRIZZO_IP
```

Sostituisci `INDIRIZZO_IP` con l'IP trovato (es: `192.168.1.100`).

Quando richiesto, inserisci la password che hai scelto durante la configurazione.

> 💡 **Suggerimento Windows:** Usa [PuTTY](https://www.putty.org/) o il terminale Windows PowerShell.

---

## 4. Registrazione sul Pannello Onesiforo

Prima di installare OnesiBox sul Raspberry Pi, devi registrare il dispositivo sul pannello Onesiforo.

### 4.1 Accedi al pannello

1. Apri il browser e vai all'indirizzo del pannello Onesiforo
   (es: `https://onesiforo.a80.it`)

2. Effettua il login con le tue credenziali

### 4.2 Crea una nuova appliance

1. Vai nella sezione **"Appliance"** o **"Dispositivi"**

2. Clicca su **"Nuova Appliance"** o **"+"**

3. Compila i campi:
   - **Nome**: Un nome descrittivo (es: "Casa Nonna Maria", "Sig. Rossi")
   - **Note**: Eventuali note utili

4. Clicca **"Salva"** o **"Crea"**

### 4.3 Ottieni le credenziali

Dopo aver creato l'appliance, il sistema ti mostrerà:

| Campo | Esempio | Descrizione |
|-------|---------|-------------|
| **UUID** | `550e8400-e29b-41d4-a716-446655440000` | Identificativo univoco |
| **Token** | `1\|abc123xyz...` | Chiave di autenticazione |

> ⚠️ **IMPORTANTE:** Copia e salva questi valori! Il token potrebbe non essere più visibile dopo aver chiuso la pagina.

**Annota questi dati:**

```
URL Server:  _________________________________

UUID:        _________________________________

Token:       _________________________________
```

---

## 5. Installazione di OnesiBox

Ora sei pronto per installare OnesiBox sul Raspberry Pi.

### 5.1 Connettiti al Raspberry Pi

Se non sei già connesso, apri un terminale e connettiti via SSH:

```bash
ssh pi@INDIRIZZO_IP
```

### 5.2 Avvia l'installazione

Esegui questo comando per scaricare e avviare l'installatore:

```bash
curl -sSL https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh | sudo bash
```

> 💡 Se il comando sopra non funziona, prova:
> ```bash
> wget -qO- https://raw.githubusercontent.com/onesiphorus-team/OnesiBox/main/install.sh | sudo bash
> ```

### 5.3 Segui la procedura guidata

L'installatore ti guiderà passo-passo. Ecco cosa ti chiederà:

---

#### Schermata 1: Verifica Prerequisiti

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Verifica Prerequisiti
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Esecuzione come root
ℹ Sistema operativo: Debian GNU/Linux 12 (bookworm)
ℹ Architettura: aarch64
✓ Connessione internet attiva
✓ Spazio disco sufficiente
```

L'installatore verificherà automaticamente che tutto sia a posto.

---

#### Schermata 2: Nome del Dispositivo

```
1. Nome del dispositivo (es: 'Casa Nonna Maria')
   Questo nome serve solo come riferimento locale.
   Nome [OnesiBox]: █
```

**Cosa inserire:** Un nome descrittivo per identificare il dispositivo.

**Esempio:** `Casa Nonna Maria` oppure premi Invio per usare il default "OnesiBox".

---

#### Schermata 3: URL del Server

```
2. URL del Server Onesiforo
   L'indirizzo del server dove si trova il pannello di controllo.
   Premi Invio per usare il server predefinito: https://onesiforo.a80.it
   URL [https://onesiforo.a80.it]: █
```

**Cosa inserire:** L'indirizzo web del pannello Onesiforo.

**Default:** Premi Invio per usare `https://onesiforo.a80.it` (server ufficiale)

**Altro server:** Inserisci l'URL completo, incluso `https://`

---

#### Schermata 4: UUID Appliance

```
3. ID Appliance (UUID)
   Lo trovi nel pannello Onesiforo quando registri una nuova appliance.
   Lascia vuoto per generarne uno automaticamente.
   UUID [genera automatico]: █
```

**Cosa inserire:** L'UUID che hai copiato dal pannello Onesiforo.

**Oppure:** Premi Invio per generare un UUID automatico. In questo caso, dovrai poi inserire l'UUID generato nel pannello Onesiforo.

---

#### Schermata 5: Token

```
4. Token di Autenticazione
   Il token segreto generato dal server Onesiforo per questa appliance.
   Lo trovi nella pagina di dettaglio dell'appliance sul pannello.
   Token (nascosto): █
```

**Cosa inserire:** Il token copiato dal pannello Onesiforo.

> 💡 Il token non viene mostrato mentre lo digiti (per sicurezza).

---

#### Schermata 6: Impostazioni Opzionali

```
5. Impostazioni Opzionali
   Intervallo polling in secondi [5]: █
   Intervallo heartbeat in secondi [30]: █
   Volume predefinito 0-100 [80]: █
```

**Consiglio:** Premi Invio per accettare i valori predefiniti. Sono adatti alla maggior parte dei casi.

---

#### Schermata 7: Conferma

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Riepilogo Configurazione
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Nome dispositivo:     Casa Nonna Maria
  URL Server:           https://onesiforo.example.com
  Appliance ID:         550e8400-e29b-41d4-a716-446655440000
  Token:                ****xyz789
  Polling:              5s
  Heartbeat:            30s
  Volume:               80%

Procedere con l'installazione? [S/n]: █
```

Verifica che i dati siano corretti e premi **S** e Invio per confermare.

### 5.4 Attendi il completamento

L'installazione richiede 10-20 minuti. Vedrai i progressi:

```
▶ Installazione Pacchetti di Sistema
ℹ Aggiornamento sistema...
✓ Sistema aggiornato
ℹ Installazione Node.js 20 LTS...
✓ Node.js v20.x.x installato
ℹ Installazione Chromium e dipendenze display...
✓ Chromium e X11 installati
...
```

### 5.5 Installazione completata

Al termine vedrai:

```
╔══════════════════════════════════════════════════════════════════╗
║              ✓ INSTALLAZIONE COMPLETATA CON SUCCESSO            ║
╚══════════════════════════════════════════════════════════════════╝

Riepilogo:
  • Nome dispositivo:  Casa Nonna Maria
  • Server:            https://onesiforo.example.com
  • Appliance ID:      550e8400-e29b-41d4-a716-446655440000
  • Directory:         /opt/onesibox
  • Log:               /var/log/onesibox
  • Utente:            onesibox

Prossimi passi:
  1. Registra l'appliance nel pannello Onesiforo se non l'hai già fatto
  2. Riavvia il Raspberry Pi per attivare la modalità kiosk:
     sudo reboot
  3. Verifica la connessione dal pannello Onesiforo
```

---

## 6. Verifica dell'Installazione

Prima di riavviare, verifica che tutto funzioni.

### 6.1 Controlla lo stato del servizio

```bash
sudo systemctl status onesibox
```

Dovresti vedere:
```
● onesibox.service - OnesiBox Client - Casa Nonna Maria
     Loaded: loaded (/etc/systemd/system/onesibox.service; enabled)
     Active: active (running) since ...
```

### 6.2 Controlla i log

```bash
journalctl -u onesibox -n 20
```

Cerca messaggi come:
```
OnesiBox client started
Connected to server: https://onesiforo.example.com
Heartbeat sent successfully
```

### 6.3 Testa l'endpoint locale

```bash
curl http://localhost:3000/api/status
```

Dovresti ricevere una risposta JSON con lo stato del dispositivo.

### 6.4 Verifica dal pannello Onesiforo

1. Accedi al pannello Onesiforo
2. Vai alla lista delle appliance
3. L'appliance dovrebbe mostrare stato **"Online"** o **"Connesso"**

---

## 7. Primo Avvio

### 7.1 Collega il Raspberry Pi alla TV

1. **Scollega** l'alimentazione dal Raspberry Pi
2. **Collega** il cavo HDMI alla TV
3. **Collega** la webcam USB
4. **Collega** le casse (se non usi l'audio HDMI)
5. **Accendi** la TV e seleziona l'ingresso HDMI corretto

### 7.2 Riavvia il Raspberry Pi

```bash
sudo reboot
```

Oppure scollega e ricollega l'alimentazione.

### 7.3 Cosa aspettarsi

Dopo il riavvio:

1. Il Raspberry Pi si avvia (30-60 secondi)
2. Appare una schermata nera con il logo OnesiBox
3. Compare il messaggio "In attesa di comandi..."
4. Il dispositivo è pronto!

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                                                                │
│                         O N E S I B O X                        │
│                                                                │
│                    In attesa di comandi...                     │
│                                                                │
│                    ● Connesso al server                        │
│                                                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 7.4 Primo test

Dal pannello Onesiforo:

1. Seleziona l'appliance
2. Invia un comando di test (es: "Riproduci video")
3. Verifica che il video appaia sulla TV

---

## 8. Risoluzione Problemi

### Il dispositivo non si connette al server

**Sintomo:** Il pannello mostra "Offline" o "Non connesso"

**Soluzioni:**

1. **Verifica la connessione internet:**
   ```bash
   ping google.com
   ```

2. **Verifica l'URL del server:**
   ```bash
   curl -I https://onesiforo.tuodominio.it
   ```

3. **Controlla il file di configurazione:**
   ```bash
   sudo cat /opt/onesibox/config/config.json
   ```

4. **Controlla i log per errori:**
   ```bash
   journalctl -u onesibox -n 50
   ```

5. **Riavvia il servizio:**
   ```bash
   sudo systemctl restart onesibox
   ```

### Lo schermo resta nero

**Sintomo:** La TV non mostra nulla o resta nera

**Soluzioni:**

1. **Verifica il cavo HDMI** - Prova un altro cavo o porta

2. **Forza l'output HDMI:**
   ```bash
   sudo nano /boot/firmware/config.txt
   ```
   Aggiungi:
   ```
   hdmi_force_hotplug=1
   hdmi_drive=2
   ```
   Salva e riavvia.

3. **Controlla che X sia in esecuzione:**
   ```bash
   ps aux | grep Xorg
   ```

### Nessun audio

**Sintomo:** I video si vedono ma non si sentono

**Soluzioni:**

1. **Verifica il volume:**
   ```bash
   amixer set Master 80%
   ```

2. **Seleziona l'output corretto:**
   ```bash
   # Lista dispositivi
   aplay -l

   # Imposta HDMI come default
   sudo raspi-config
   # System Options → Audio → HDMI
   ```

3. **Testa l'audio:**
   ```bash
   speaker-test -t wav -c 2
   ```

### La webcam non funziona

**Sintomo:** Zoom non mostra il video

**Soluzioni:**

1. **Verifica che sia riconosciuta:**
   ```bash
   lsusb
   v4l2-ctl --list-devices
   ```

2. **Testa la webcam:**
   ```bash
   ffplay /dev/video0
   ```

3. **Controlla i permessi:**
   ```bash
   ls -la /dev/video*
   # L'utente onesibox deve essere nel gruppo video
   groups onesibox
   ```

### Come accedere se lo schermo mostra il kiosk

Se devi fare manutenzione ma lo schermo mostra solo il kiosk:

1. **Via SSH** (metodo consigliato):
   ```bash
   ssh pi@INDIRIZZO_IP
   ```

2. **Cambia TTY** (con tastiera collegata):
   Premi `Ctrl + Alt + F2` per passare a un terminale testuale

### Come aggiornare la configurazione

Se devi cambiare server, token o altre impostazioni:

```bash
sudo /opt/onesibox/reconfigure.sh
```

---

## 9. Comandi Utili

### Gestione servizio

| Comando | Descrizione |
|---------|-------------|
| `sudo systemctl status onesibox` | Stato del servizio |
| `sudo systemctl start onesibox` | Avvia il servizio |
| `sudo systemctl stop onesibox` | Ferma il servizio |
| `sudo systemctl restart onesibox` | Riavvia il servizio |
| `sudo systemctl enable onesibox` | Abilita all'avvio |
| `sudo systemctl disable onesibox` | Disabilita all'avvio |

### Log e diagnostica

| Comando | Descrizione |
|---------|-------------|
| `journalctl -u onesibox -f` | Log in tempo reale |
| `journalctl -u onesibox -n 100` | Ultime 100 righe di log |
| `journalctl -u onesibox --since "1 hour ago"` | Log ultima ora |
| `curl http://localhost:3000/api/status` | Stato API locale |

### Sistema

| Comando | Descrizione |
|---------|-------------|
| `sudo reboot` | Riavvia il dispositivo |
| `sudo shutdown -h now` | Spegni il dispositivo |
| `hostname -I` | Mostra indirizzo IP |
| `df -h` | Spazio disco |
| `free -h` | Memoria RAM |
| `vcgencmd measure_temp` | Temperatura CPU |

### Configurazione

| Comando | Descrizione |
|---------|-------------|
| `sudo nano /opt/onesibox/config/config.json` | Modifica configurazione |
| `sudo /opt/onesibox/reconfigure.sh` | Wizard riconfigurazione |
| `cat /opt/onesibox/config/config.json` | Visualizza configurazione |

---

## 10. Domande Frequenti

### Posso usare il WiFi invece del cavo Ethernet?

Sì, ma il cavo Ethernet è consigliato per maggiore stabilità. Se usi il WiFi:
- Configura la rete durante la preparazione della scheda SD
- Posiziona il Raspberry Pi vicino al router
- Evita interferenze (microonde, telefoni cordless)

### Quanto consuma di corrente?

- Raspberry Pi 4: circa 3-5W in uso normale
- Raspberry Pi 5: circa 5-8W in uso normale
- Costo annuo stimato: 5-10€ di elettricità

### Posso installare più dispositivi?

Sì! Ogni dispositivo:
- Ha il proprio UUID
- Ha il proprio token
- Viene gestito separatamente dal pannello

### Come aggiorno OnesiBox?

```bash
cd /opt/onesibox
sudo git pull origin main
sudo npm install --production
sudo systemctl restart onesibox
```

### Posso usare un Raspberry Pi 3?

Non consigliato. Il Pi 3 ha:
- RAM limitata (1GB)
- CPU meno potente
- Problemi con video HD

Usa almeno un Raspberry Pi 4 con 2GB di RAM.

### Come faccio il backup della configurazione?

```bash
sudo cp /opt/onesibox/config/config.json ~/config-backup.json
```

Per ripristinare:
```bash
sudo cp ~/config-backup.json /opt/onesibox/config/config.json
sudo systemctl restart onesibox
```

### Il token è scaduto, come lo rigenero?

1. Accedi al pannello Onesiforo
2. Vai ai dettagli dell'appliance
3. Clicca "Rigenera token"
4. Sul Raspberry Pi, esegui:
   ```bash
   sudo /opt/onesibox/reconfigure.sh
   ```
5. Scegli l'opzione 2 e inserisci il nuovo token

### Posso accedere al dispositivo da remoto?

Se il dispositivo è dietro un router/NAT, per accedere da remoto puoi:
- Usare una VPN (WireGuard, OpenVPN)
- Configurare port forwarding sul router (sconsigliato per sicurezza)
- Usare servizi come Tailscale o ZeroTier

### Come disinstallo OnesiBox?

```bash
sudo systemctl stop onesibox
sudo systemctl disable onesibox
sudo rm /etc/systemd/system/onesibox.service
sudo rm -rf /opt/onesibox
sudo userdel -r onesibox
```

---

## Supporto

Se hai problemi non risolti da questo manuale:

1. **Controlla i log** per messaggi di errore specifici
2. **Consulta la documentazione** nella cartella `/opt/onesibox/docs/`
3. **Apri una issue** su GitHub: https://github.com/onesiphorus-team/OnesiBox/issues

---

*Ultima modifica: Gennaio 2026*

*Onesiphorus Team - "Per la premura mostrata"*
