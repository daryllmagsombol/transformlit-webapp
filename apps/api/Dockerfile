FROM node:22-bookworm-slim

WORKDIR /workspace

COPY . .

RUN npm install
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3005

CMD ["npm", "run", "start:prod", "--workspace", "apps/api"]