# Build stage — compile TS to dist/
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json tsconfig.json ./
RUN npm install --omit=optional --no-audit --no-fund
COPY src ./src
RUN npx tsc -p tsconfig.json

# Runtime stage — distroless Node 24, non-root, read-only fs
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY package.json ./package.json

# AKS Helm chart mounts the actual MCP root over /var/mcp/root
ENV MCP_ROOT=/var/mcp/root
ENV PORT=8080

EXPOSE 8080
USER nonroot
CMD ["dist/server.js"]
