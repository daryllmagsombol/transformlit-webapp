FROM node:22-bookworm-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec turbo run build --filter=@transformlit/web...

FROM node:22-bookworm-slim
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /workspace/apps/web/public ./apps/web/public
COPY --from=builder /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=builder /workspace/packages/shared/package.json ./packages/shared/package.json

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
