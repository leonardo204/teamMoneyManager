# Dockerfile — teamMoneyManager
# node:20-slim 기반. better-sqlite3 네이티브 빌드를 위해 build toolchain 설치.
FROM node:20-slim

# better-sqlite3 컴파일에 필요한 도구(prebuilt 미사용 시 대비).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 레이어 캐시: lockfile 있으면 npm ci, 없으면 npm install.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# 애플리케이션 소스.
COPY . .

# 컨테이너 내부 포트 (compose에서 49876:8080 매핑).
ENV PORT=8080
EXPOSE 8080

# SQLite 파일 영속 (compose volume: data:/app/data).
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
