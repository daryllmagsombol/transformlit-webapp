FROM node:22-bookworm-slim

WORKDIR /workspace

ENV NODE_ENV=production

COPY . .

RUN npm install
RUN npm run build

EXPOSE 3005

CMD ["npm", "run", "start:prod", "--workspace", "apps/api"]