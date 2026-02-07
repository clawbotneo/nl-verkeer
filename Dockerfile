# Minimal production Dockerfile for Next.js (App Router)
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Run stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# If you want to reduce image size further, we can switch to standalone output later.
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/src ./src

EXPOSE 3000
ENV PORT=3000

CMD ["npm","run","start"]
