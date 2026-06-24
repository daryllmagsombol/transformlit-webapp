FROM node:22-bookworm-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter=@transformlit/api run db:generate
RUN pnpm exec turbo run build --filter=@transformlit/api...

FROM node:22-bookworm-slim
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY --from=builder /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=builder /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=builder /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install only production deps for the API
RUN pnpm install --frozen-lockfile --prod --filter=@transformlit/api

ENV NODE_ENV=production
EXPOSE 3005

CMD ["node", "apps/api/dist/main.js"]
