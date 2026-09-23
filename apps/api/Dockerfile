FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /workspace

RUN npm install -g pnpm@10
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter=@transformlit/api run db:generate && \
    pnpm exec turbo run build --filter=@transformlit/api... && \
    chown -R node:node /workspace
USER node

ENV NODE_ENV=production
EXPOSE 3005

CMD ["node", "apps/api/dist/src/main.js"]
