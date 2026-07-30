FROM node:22-alpine AS build
WORKDIR /app

COPY packages/contracts/package*.json packages/contracts/
COPY packages/contracts/tsconfig.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
RUN npm install --prefix packages/contracts \
  && npm run build --prefix packages/contracts

COPY services/api/package*.json services/api/
RUN npm install --prefix services/api
COPY services/api services/api
RUN npm run build --prefix services/api
RUN cp -R services/api/migrations services/api/dist/migrations

FROM node:22-alpine AS runtime
WORKDIR /app/services/api
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
USER node
CMD ["node", "dist/src/index.js"]
