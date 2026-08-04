FROM docker.io/cloudflare/sandbox:0.7.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 8080
