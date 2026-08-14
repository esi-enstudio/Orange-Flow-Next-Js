FROM node:20-slim

WORKDIR /app

# System dependencies for headless Chromium (used by whatsapp-web.js)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY server.js ./

ENV CHROME_PATH=/usr/bin/chromium

EXPOSE 3001

CMD ["node", "server.js"]
