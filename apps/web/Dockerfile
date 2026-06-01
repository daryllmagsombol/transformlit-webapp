FROM node:22-bullseye-slim
WORKDIR /workspace

ARG NEXT_PUBLIC_API_URL=http://localhost:3005/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN npm install && npm install lightningcss-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu --no-save

COPY . .
RUN npx turbo run build --filter=web...

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "apps/web"]
