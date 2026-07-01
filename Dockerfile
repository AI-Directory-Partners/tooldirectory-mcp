# tooldirectory-mcp — zero-dependency stdio MCP server.
# No install/build step: the server is a single Node file with no runtime deps.
FROM node:20-slim
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
CMD ["node", "src/index.js"]
