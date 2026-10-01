FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS builder
WORKDIR /workspace

ARG NEXT_PUBLIC_API_URL=http://localhost:3005/graphql
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG NEXT_PUBLIC_WS_URL=ws://localhost:3005/graphql
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm install -g pnpm@11.24.0

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec turbo run build --filter=@transformlit/web...

# Fail the build loudly if the postbuild PWA asset generation did not run.
RUN test -f apps/web/public/sw.js && test -f apps/web/public/pwa-assets.json

FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone/ ./
COPY --from=builder --chown=node:node /workspace/apps/web/public/ ./apps/web/public/
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static/ ./apps/web/.next/static/

USER node

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
