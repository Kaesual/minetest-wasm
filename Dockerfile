FROM ubuntu:20.04

RUN echo "tzdata tzdata/Areas select Europe" | debconf-set-selections
RUN echo "tzdata tzdata/Zones/Europe select Berlin" | debconf-set-selections
RUN DEBIAN_FRONTEND=noninteractive apt-get update
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y git python3 build-essential cmake tclsh zip zstd gettext wget
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
RUN umask 000 && mkdir -p /minetest-wasm
ENTRYPOINT ["/docker-entrypoint.sh"]