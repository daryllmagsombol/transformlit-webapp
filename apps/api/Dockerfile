# TODO: re-resolve digest periodically (pinned 2026-09-07 from Docker Hub registry API)
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
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

# Install/build run as root (pnpm workspace install + prisma generate require it);
# only the runtime tree is handed over to the non-root `node` user before CMD.
RUN chown -R node:node /workspace
USER node

ENV NODE_ENV=production
EXPOSE 3005

CMD ["node", "apps/api/dist/src/main.js"]
