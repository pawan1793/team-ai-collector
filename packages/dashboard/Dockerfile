FROM node:20-alpine AS build
WORKDIR /app
COPY packages/dashboard/package.json ./package.json
RUN npm install
COPY packages/dashboard ./
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
