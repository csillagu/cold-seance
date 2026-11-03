# The application image (SC-028, DD-040): the built frontend and the backend, which serves it beside
# the REST API, in one image that runs one process. Its PostgreSQL database is given by its
# configuration (FR-177, DD-059), so the same image runs next to the bundled PostgreSQL of the
# Compose file or against an existing or hosted one.
#
#   docker build -t cold-seance .
#   docker run -p 3000:3000 -e COLD_SEANCE_DATABASE_URL=postgres://… -v ./config.yaml:/app/config.yaml:ro cold-seance
#
# The Node.js major version follows .nvmrc.
ARG NODE_IMAGE=node:26-alpine

# Builds both packages with every dependency, dev ones included.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY tsconfig.base.json ./
COPY backend backend
COPY frontend frontend
RUN npm run build

# Installs what the backend needs at run time, and nothing else: the frontend runs in the browser.
FROM ${NODE_IMAGE} AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace backend && npm cache clean --force

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
# Listen on every interface of the container, so its published port reaches the backend; outside
# the image the default stays 127.0.0.1. The port stays the default, 3000.
ENV COLD_SEANCE_SERVER_HOST=0.0.0.0
WORKDIR /app
COPY --from=runtime-dependencies /app/node_modules node_modules
COPY package.json ./
COPY backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
# The migrations the backend applies at start (SC-074), journal included.
COPY backend/drizzle backend/drizzle
COPY --from=build /app/frontend/dist frontend/dist
# The configuration file, if one is used, is mounted at /app/config.yaml (the default file in the
# working directory) or named by COLD_SEANCE_CONFIG_FILE; it holds secrets, so it is never built in.
USER node
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
