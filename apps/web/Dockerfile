FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /workspace

ARG NEXT_PUBLIC_API_URL=http://localhost:3005/graphql
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG NEXT_PUBLIC_WS_URL=ws://localhost:3005/graphql
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

# Install/build run as root (pnpm workspace install requires it);
# only the runtime tree is handed over to the non-root `node` user before CMD.
RUN pnpm exec turbo run build --filter=@transformlit/web... && \
    chown -R node:node /workspace
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "@transformlit/web", "run", "start"]
