# Imagem enxuta: o projeto não tem dependências além do Node.js
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/app/data/clockr.db \
    APP_TIMEZONE=America/Sao_Paulo

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

# Roda como usuário sem privilégios e guarda o banco num volume
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
