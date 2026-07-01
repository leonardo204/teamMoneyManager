#!/usr/bin/env bash
# scripts/backup.sh — teamMoneyManager 데이터 볼륨 백업 (NFR-02)
#
# SQLite 파일 하나(data 볼륨의 app.db)가 전체 상태다. 이 스크립트는 named volume
# `teammoneymanager_data`를 tar.gz로 덤프한다. 앱을 멈추지 않아도 되지만, 완전한
# 일관성을 원하면 백업 전 `docker compose stop app`을 권장한다.
#
# 사용법:
#   ./scripts/backup.sh                 # ./backups/app-db-YYYYmmdd-HHMMSS.tar.gz 생성
#   ./scripts/backup.sh /path/out.tgz   # 지정 경로로 저장
#
# 복원(restore):
#   docker compose down                 # 앱 정지(-v 금지: 볼륨 유지)
#   docker run --rm -v teammoneymanager_data:/data -v "$PWD":/backup busybox \
#     sh -c "rm -rf /data/* && tar xzf /backup/app-db-YYYYmmdd-HHMMSS.tar.gz -C /data"
#   docker compose up -d
set -euo pipefail

# compose 프로젝트명 기본값은 디렉토리명 소문자. 필요 시 VOLUME 환경변수로 덮어쓴다.
VOLUME="${VOLUME:-teammoneymanager_data}"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-}"
if [ -z "$OUT" ]; then
  mkdir -p backups
  OUT="backups/app-db-${TS}.tar.gz"
fi

# 절대 경로로 정규화(호스트 마운트에 사용).
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
OUT_BASE="$(basename "$OUT")"

echo "[backup] volume=${VOLUME} -> ${OUT_DIR}/${OUT_BASE}"

docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${OUT_DIR}:/backup" \
  busybox \
  tar czf "/backup/${OUT_BASE}" -C /data .

echo "[backup] done: ${OUT_DIR}/${OUT_BASE}"
docker run --rm -v "${OUT_DIR}:/backup" busybox tar tzf "/backup/${OUT_BASE}"
