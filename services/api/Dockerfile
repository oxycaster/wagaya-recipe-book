FROM node:24.12.0-bookworm-slim
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY *.mjs schema.sql ./
USER node
EXPOSE 4320
CMD ["node", "index.mjs"]
