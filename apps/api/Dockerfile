FROM node:22-bookworm-slim
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN apt-get update -y && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PRISMA_QUERY_ENGINE_LIBRARY=openssl-1.1.x
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npx turbo run build --filter=api...

ENV NODE_ENV=production

EXPOSE 3005

CMD ["npm", "run", "start:prod", "--workspace", "apps/api"]
