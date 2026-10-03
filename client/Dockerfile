FROM node:22-alpine AS builder
WORKDIR /user/client
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
