FROM node:22-bullseye-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm turbo run build --filter=@transformlit/web...

FROM node:22-bullseye-slim
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /workspace/apps/web/public ./apps/web/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
