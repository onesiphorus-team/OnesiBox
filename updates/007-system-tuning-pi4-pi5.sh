#!/bin/bash
#
# Migration 007: ottimizzazioni di sistema comuni a Pi 4 e Pi 5
#
# Applica scripts/system-tuning.sh ai box gia' installati: attesa del
# compositor e riavvii illimitati per onesibox.service, audio senza
# sospensione, journal persistente, swappiness bassa e, solo sul Pi 4,
# governor CPU "performance". Dettagli e motivazioni nello script.
#
# Idempotente e senza riavvii di servizi: sicura anche se gira durante una
# riunione.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$SCRIPT_DIR" bash "$SCRIPT_DIR/scripts/system-tuning.sh"
