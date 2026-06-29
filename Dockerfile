FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y ffmpeg

RUN npm ci --build-from-source=sqlite3

COPY . .

CMD ["npm", "start"]