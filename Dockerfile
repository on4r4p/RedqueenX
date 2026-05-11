FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
  ADMIN_HOST=0.0.0.0 \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  PLAYWRIGHT_DISABLE_SANDBOX=true

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    dnsutils \
    dumb-init \
    iproute2 \
    iptables \
    openvpn \
    procps \
    socat \
    xauth \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend ./frontend
COPY --from=build /app/ops ./ops
COPY --from=build /app/scripts ./scripts

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]
