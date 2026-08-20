FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/observability/package.json packages/observability/

RUN npm ci --workspace=@radar/observability --include-workspace-root

COPY packages/shared packages/shared
COPY packages/observability packages/observability
COPY tsconfig.base.json tsconfig.base.json

RUN npm run build -w @radar/shared && npm run build -w @radar/observability

ENV PORT=3020
EXPOSE 3020

CMD ["node", "packages/observability/dist/main.js"]
