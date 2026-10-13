FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    HOME=/data \
    ROUTINE_API_HOST=0.0.0.0 \
    ROUTINE_API_PORT=8787

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && mkdir -p /data/.gemini-code && chown -R node:node /data
COPY . .
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/gemini-code.js", "routines", "service"]
