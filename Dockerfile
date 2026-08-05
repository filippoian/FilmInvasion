FROM ghcr.io/puppeteer/puppeteer:latest
# Crea la cartella con i permessi corretti per l'utente pptruser
USER root
RUN mkdir -p /app && chown -R pptruser:pptruser /app
USER pptruser

WORKDIR /app
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install
COPY --chown=pptruser:pptruser . .

EXPOSE 3001
CMD ["node", "server.js"]
