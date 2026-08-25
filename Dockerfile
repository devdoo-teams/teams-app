FROM node:22-alpine AS build

WORKDIR /app
RUN apk add --no-cache git
ARG TEAMS_SOURCE_COMMIT
ENV TEAMS_SOURCE_COMMIT=${TEAMS_SOURCE_COMMIT}
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3978
ARG TEAMS_SOURCE_COMMIT=unknown
ENV TEAMS_SOURCE_COMMIT=${TEAMS_SOURCE_COMMIT}

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/appPackage ./appPackage

RUN mkdir -p /app/data
EXPOSE 3978
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3978) + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
