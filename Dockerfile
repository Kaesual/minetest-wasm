FROM ubuntu:20.04

RUN echo "tzdata tzdata/Areas select Europe" | debconf-set-selections
RUN echo "tzdata tzdata/Zones/Europe select Berlin" | debconf-set-selections
RUN DEBIAN_FRONTEND=noninteractive apt-get update
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y git python3 build-essential cmake tclsh zip zstd gettext wget
RUN umask 000 && mkdir -p /minetest_src
COPY . /minetest_src
RUN cp /minetest_src/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
RUN umask 000 && mkdir -p /build_from_docker
RUN useradd -m -s /bin/bash builder
RUN mv /minetest_src /home/builder/minetest-wasm
RUN chown -R builder:builder /home/builder

USER builder
WORKDIR /home/builder
RUN \
	cd minetest-wasm && \
	./install_emsdk.sh && \
	./build_all.sh
RUN chmod -R 777 /home/builder
ENTRYPOINT ["/docker-entrypoint.sh"]