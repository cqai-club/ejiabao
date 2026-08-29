FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Prisma CLI is required at container startup for `prisma migrate deploy`.
# Keep it in this image until migrations are moved to a separate release job.
RUN npm ci
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
# The product-promotion worker executes these Python scripts on the server.
# They must live inside the production image, never on the U-disk client.
COPY workflows ./workflows
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
