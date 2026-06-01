FROM node:22-bullseye-slim
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN npm install

COPY . .
RUN npm run db:generate --workspace=apps/api
RUN npx turbo run build --filter=api...

ENV NODE_ENV=production

EXPOSE 3005

CMD ["npm", "run", "start:prod", "--workspace", "apps/api"]
