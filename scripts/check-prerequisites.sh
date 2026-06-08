#!/usr/bin/env bash
set -euo pipefail

INSTALL_MISSING="${INSTALL_MISSING:-true}"
export PATH="${HOME}/.arkade/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

require_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    echo "ok  $name ($(command -v "$name"))"
    return 0
  fi

  echo "missing  $name" >&2
  return 1
}

install_with_brew() {
  local package="$1"
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required to install ${package}" >&2
    return 1
  fi

  echo "Installing ${package} with brew..."
  brew install "$package"
}

install_faas_cli() {
  if command -v faas-cli >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v arkade >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      echo "Installing arkade with brew..."
      brew install arkade
    else
      echo "Installing arkade..."
      curl -sSL https://get.arkade.dev | sh
    fi
  fi

  echo "Installing faas-cli with arkade..."
  arkade get faas-cli
  export PATH="${HOME}/.arkade/bin:${PATH}"
}

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    echo "Docker daemon is not running. Starting Docker Desktop..."
    open -a Docker >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      if docker info >/dev/null 2>&1; then
        echo "Docker is ready."
        return 0
      fi
      sleep 2
    done
  fi

  echo "Docker daemon is not running. Start Docker Desktop and retry." >&2
  return 1
}

missing=()

echo "Checking Mod B prerequisites..."

for cmd in docker k3d kubectl helm curl; do
  if ! require_command "$cmd"; then
    missing+=("$cmd")
  fi
done

if ! require_command faas-cli; then
  missing+=("faas-cli")
fi

if [ "${#missing[@]}" -gt 0 ] && [ "$INSTALL_MISSING" = "true" ]; then
  echo "Attempting to install missing tools: ${missing[*]}"

  for cmd in "${missing[@]}"; do
    case "$cmd" in
      docker)
        ensure_docker_running || exit 1
        ;;
      faas-cli)
        install_faas_cli
        ;;
      k3d|kubectl|helm|k6)
        install_with_brew "$cmd"
        ;;
      curl)
        echo "curl is required but could not be installed automatically" >&2
        exit 1
        ;;
    esac
  done

  export PATH="${HOME}/.arkade/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

  missing=()
  for cmd in docker k3d kubectl helm curl faas-cli; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Still missing: ${missing[*]}" >&2
  exit 1
fi

ensure_docker_running

echo "All Mod B prerequisites are available."
