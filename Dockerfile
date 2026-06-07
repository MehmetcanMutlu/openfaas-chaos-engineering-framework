FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
COPY src ./src

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]

