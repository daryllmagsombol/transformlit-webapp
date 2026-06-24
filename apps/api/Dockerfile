FROM node:22-bullseye-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --prod=false

COPY . .

RUN pnpm run db:generate --filter=@transformlit/api
RUN pnpm turbo run build --filter=@transformlit/api...

FROM node:22-bullseye-slim
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY --from=builder /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder /workspace/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=builder /workspace/apps/api/package.json ./apps/api/
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/pnpm-lock.yaml ./pnpm-lock.yaml

ENV NODE_ENV=production
EXPOSE 3005

CMD ["node", "apps/api/dist/main.js"]
