# OnesiBox Update Migrations

Questa cartella contiene script di migrazione che vengono eseguiti automaticamente durante gli aggiornamenti.

## Come funziona

1. Lo script `update.sh` esegue `git pull`
2. Cerca tutti i file `.sh` in questa cartella
3. Esegue solo quelli che non sono stati ancora eseguiti (tracciati in `/opt/onesibox/data/.update-state`)
4. Gli script vengono eseguiti in ordine alfabetico

## Convenzioni di naming

```
NNN-descrizione-breve.sh
```

- `NNN`: Numero sequenziale a 3 cifre (001, 002, 003...)
- `descrizione-breve`: Nome descrittivo con trattini

## Creare una nuova migrazione

1. Trova il prossimo numero disponibile
2. Crea il file con il pattern corretto
3. Rendi lo script idempotente (sicuro da eseguire più volte)
4. Testa localmente prima di pushare

## Esempio

```bash
#!/bin/bash
#
# Migration 002: Descrizione
#

echo "Eseguendo operazione..."
# La tua logica qui
echo "Completato"
```

## Best practices

- Gli script devono essere idempotenti
- Usa `echo` per loggare il progresso
- Exit code 0 = successo, altri = fallimento
- Non fare mai `exit 1` senza un buon motivo
- Testa su un dispositivo di sviluppo prima

## Migrazioni esistenti

| # | Nome | Descrizione |
|---|------|-------------|
| 002 | fix-systemd-permissions | Aggiunge /run/user/UID, DBUS e zoom directory al servizio systemd |
| 003 | create-zoom-directory | Crea la directory ~/.onesibox-zoom per il client Zoom web |
| 004 | install-playwright-browser | Installa il browser Playwright necessario per Zoom |
| 005 | fix-zoom-directory-permissions | Aggiunge ~/.onesibox-zoom a ReadWritePaths per Zoom |
