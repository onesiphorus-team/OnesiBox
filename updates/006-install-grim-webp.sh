#!/bin/bash
#
# Migration 006: Install grim (Wayland screenshot) and webp (cwebp compressor)
# Required for diagnostic screenshots feature (v0.10.0+).
#
# Idempotent: apt-get install is a no-op if packages are already present.
#

set -e

echo "Installing grim and webp for diagnostic screenshots..."

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y --no-install-recommends grim webp

echo "Verifying binaries..."
which grim && grim --help 2>&1 | head -1 || { echo "ERROR: grim not available after install"; exit 1; }
which cwebp && cwebp -version 2>&1 | head -1 || { echo "ERROR: cwebp not available after install"; exit 1; }

echo "Done"
