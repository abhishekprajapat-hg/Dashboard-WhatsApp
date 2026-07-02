FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci

FROM base AS client-build
COPY client ./client
RUN npm run build --workspace client

FROM nginx:1.27-alpine AS client
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
EXPOSE 80

FROM base AS api
ENV NODE_ENV=production
COPY server ./server
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "index.js"]
