FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
  ADMIN_HOST=0.0.0.0 \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
  PLAYWRIGHT_DISABLE_SANDBOX=false

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux-signing-keyring.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    dnsutils \
    dumb-init \
    firefox-esr \
    fluxbox \
    fonts-liberation \
    google-chrome-stable \
    iproute2 \
    iptables \
    novnc \
    numlockx \
    openvpn \
    procps \
    socat \
    websockify \
    autocutsel \
    x11-xkb-utils \
    x11-utils \
    x11vnc \
    xauth \
    xclip \
    xsel \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend ./frontend
COPY --from=build /app/ops ./ops
COPY --from=build /app/scripts ./scripts

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]
