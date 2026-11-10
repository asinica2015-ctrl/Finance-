FROM node:22-alpine
WORKDIR /app
COPY package.json ./
# Драйверы для Postgres/MySQL; для SQLite ничего не нужно
RUN npm i --omit=dev --no-audit --no-fund || true
COPY . .
ENV PORT=3000
VOLUME /app/data
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
