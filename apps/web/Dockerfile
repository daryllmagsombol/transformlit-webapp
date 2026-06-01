FROM node:22-bookworm-slim

WORKDIR /workspace

ENV NODE_ENV=production

ARG NEXT_PUBLIC_API_URL=http://localhost:3005/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY . .

RUN npm install
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "apps/web"]