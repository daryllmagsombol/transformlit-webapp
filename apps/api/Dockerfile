FROM node:22-bookworm-slim
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

ENV NODE_ENV=production
EXPOSE 3005

CMD ["node", "apps/api/dist/src/main.js"]
