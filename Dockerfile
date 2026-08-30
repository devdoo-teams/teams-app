FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3978
ENV TEAMS_RUNTIME_DIST_DIR=/app/dist
ARG TEAMS_SOURCE_COMMIT=unknown
ENV TEAMS_SOURCE_COMMIT=${TEAMS_SOURCE_COMMIT}

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# dist is built, source-verified, and tested by the CI job before Docker
# packaging. Reusing it avoids a second build in a different libc/toolchain.
COPY dist ./dist
COPY appPackage ./appPackage
COPY scripts/start-server.mjs ./scripts/start-server.mjs
COPY scripts/runtime-dist.mjs ./scripts/runtime-dist.mjs
COPY scripts/verify-runtime-dist.mjs /tmp/verify-runtime-dist.mjs
RUN node /tmp/verify-runtime-dist.mjs && rm /tmp/verify-runtime-dist.mjs

RUN mkdir -p /app/data
EXPOSE 3978
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3978) + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["npm", "start"]
