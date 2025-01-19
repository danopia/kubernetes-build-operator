FROM denoland/deno:alpine-1.31.2
WORKDIR /app

ADD lib/deps.ts lib/
RUN ["deno", "cache", "lib/deps.ts"]

ADD lib lib/
RUN ["deno", "check", "lib/main.ts"]

ENTRYPOINT ["deno", "run", "--unstable", "--allow-net", "--allow-hrtime", "--allow-read", "--allow-env", "--cached-only", "lib/main.ts"]
