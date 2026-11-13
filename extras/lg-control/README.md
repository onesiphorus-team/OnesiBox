# lg-control: commutazione ingresso TV LG (webOS)

Script per portare la TV LG sull'ingresso dell'OnesiBox (HDMI 2) o sulla TV
normale, comandabili da remoto tramite il comando `custom_script` di OnesiBox.

Questi file sono la versione in produzione su un box Pi 5 al 13/11/2026, quella
verificata sul campo: sono copiati **senza modifiche**. Prima di cambiarli,
provarli su un box di prova.

## Come funziona

```
OnesiBox (custom_script "to-box")
  └─ /opt/onesibox/custom-scripts/to-box.sh     wrapper, vedi custom-scripts/
       └─ ~/lg-control/to-box.sh
            └─ lg-run.sh to-box com.webos.app.hdmi2
                 ├─ discover-tv.sh   trova l'IP della TV verificandone il MAC
                 │                   (ARP → hostname LGWebOSTV / IP fisso →
                 │                   scansione della /24 → Wake-on-LAN e riprova)
                 └─ lg-switch.js     si connette via wss://<tv>:3001 e lancia l'app
```

| File | Ruolo |
|---|---|
| `to-box.sh` / `to-tv.sh` | Ingresso HDMI 2 / Live TV |
| `lg-run.sh` | Scoperta della TV + `lg-switch.js`, log in `lg-control.log` (max 2000 righe); in errore scrive anche su stderr, che e' cio' che OnesiBox riporta |
| `discover-tv.sh` | Accetta solo la TV con il MAC di `.tv-mac`: tutte le LG si chiamano "LGWebOSTV" e un IP fisso puo' finire su un'altra TV |
| `lg-switch.js` | Lancia un'app webOS (`com.webos.app.hdmi2`, `com.webos.app.livetv`, ...) |
| `wake-tv.js` | Magic packet Wake-on-LAN (serve "Mobile TV On" attivo sulla TV) |
| `tv-status.js` | Diagnostica: ingresso attivo, volume e mute (esce 0 se ingresso giusto e audio udibile) |
| `custom-scripts/*.sh` | Wrapper da copiare in `/opt/onesibox/custom-scripts/` |

Variabili d'ambiente utili: `TV_IP_FALLBACK` (default `192.168.1.48`),
`SUBNET` (default `192.168.1`), `WOL=0` per non accendere la TV,
`LG_TV_HOST` per forzare l'host, `LG_VOLUME_MINIMO` (default 8) per `tv-status.js`.

## Installazione su un box

```bash
# come utente admin
mkdir -p ~/lg-control && cp -a extras/lg-control/. ~/lg-control/
cd ~/lg-control && npm ci --omit=dev
echo "aa:bb:cc:dd:ee:ff" > .tv-mac       # MAC della TV (vedi .tv-mac.example)

# wrapper per il comando custom_script
sudo mkdir -p /opt/onesibox/custom-scripts
sudo cp ~/lg-control/custom-scripts/*.sh /opt/onesibox/custom-scripts/
sudo chmod +x /opt/onesibox/custom-scripts/*.sh ~/lg-control/*.sh ~/lg-control/*.js
```

Abbinamento: al primo `./to-box.sh` la TV mostra a schermo la richiesta di
autorizzazione; una volta accettata, `lgtv2` salva la chiave in `lg-key-`.
Chiave e MAC sono dati dell'impianto e restano fuori dal repository
(vedi `.gitignore`): per ripristinare un box esistente, copiarli dal backup.

`/opt/onesibox/custom-scripts/` non e' tracciato da git e `update.sh` non lo
cancella (fa `git reset --hard`, non `git clean`).

## Particolarita' note (lasciate com'erano)

- `tv-status.js` usa un percorso fisso (`/home/admin/lg-control`) e un host di
  default diverso dagli altri script (`192.168.1.57`), e non passa da
  `discover-tv.sh`: per un risultato affidabile chiamarlo con
  `LG_TV_HOST=$(./discover-tv.sh) node tv-status.js`.
- `lg-switch.js` e `tv-status.js` disattivano la verifica TLS: la TV usa un
  certificato autofirmato.
