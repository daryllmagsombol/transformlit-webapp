FROM node:22-bookworm-slim
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npx turbo run build --filter=api...

ENV NODE_ENV=production

EXPOSE 3005

CMD ["npm", "run", "start:prod", "--workspace", "apps/api"]
