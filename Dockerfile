FROM node:22-alpine
WORKDIR /app
COPY package.json server.js game-core.js index.html app.js styles.css ./
COPY assets ./assets
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
