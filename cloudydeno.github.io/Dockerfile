FROM denoland/deno:alpine-1.31.2

RUN apk add --no-cache smartmontools

WORKDIR /app

ADD lib lib/
RUN ["deno", "check", "lib/BlockDevice/mod.ts"]
