FROM ghcr.io/puppeteer/puppeteer:latest

USER root
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app && chown -R pptruser:pptruser /app
USER pptruser

WORKDIR /app
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install
COPY --chown=pptruser:pptruser . .

EXPOSE 3001
CMD ["xvfb-run", "--server-args=-screen 0 1024x768x24", "node", "server.js"]
