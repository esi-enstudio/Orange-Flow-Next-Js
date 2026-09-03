FROM node:22-alpine

RUN apk add --no-cache bash git curl docker-cli flock

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js deploy.sh ./
RUN chmod +x deploy.sh

RUN mkdir -p /app/state

EXPOSE 8100

CMD ["node", "server.js"]
