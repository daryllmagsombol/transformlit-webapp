FROM node:22-bookworm-slim
WORKDIR /workspace

ARG NEXT_PUBLIC_API_URL=http://localhost:3005/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm install -g pnpm@10

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/graphql/package.json packages/graphql/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec turbo run build --filter=@transformlit/web...

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "@transformlit/web", "run", "start"]
