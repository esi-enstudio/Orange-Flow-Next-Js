FROM node:22-alpine

RUN apk add --no-cache bash git curl docker-cli flock openssh-client

WORKDIR /app

# Env needed to snapshot/rollback the database from the Postgres container.
# .env is a bind-mounted host file, not baked into the image — these are only
# fallbacks for `docker compose config` validation.
ENV DB_CONTAINER=orange_flow_db \
    DB_USER=postgres \
    DB_NAME=orange_flow_dev_db

COPY package.json ./
RUN npm install --production

COPY server.js deploy.sh snapshot.sh rollback.sh ./
RUN chmod +x deploy.sh snapshot.sh rollback.sh

RUN mkdir -p /app/state

EXPOSE 8100

CMD ["node", "server.js"]
