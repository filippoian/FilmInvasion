FROM ghcr.io/puppeteer/puppeteer:latest
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
