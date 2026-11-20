# The wiki as one container: a single Node process, no database. Pages are files in /data/drafts, so mount a persistent, backed-up volume there.
#
#   docker build -t planetdds-wiki .
#   docker run -d --name wiki -p 3000:3000 -v wiki-data:/data --env-file .env planetdds-wiki
#
# Put it behind the company's sign-in proxy and set TRUSTED_EMAIL_HEADER (see README.md, "Sign-in"). Run exactly one copy.

FROM node:22-slim

WORKDIR /app

# Only what the server needs to run (no build-time packages such as pdfjs-dist, so a scan finds no known vulnerabilities)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Pages and everything else the server writes live on the volume, not in the image
ENV NODE_ENV=production \
    PORT=3000 \
    DRAFTS_DIR=/data/drafts
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data

USER node
EXPOSE 3000

# The health route answers when the process is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
