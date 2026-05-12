FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    openjdk-17-jdk-headless \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m runner

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8000

USER runner

CMD ["node", "server.js"]