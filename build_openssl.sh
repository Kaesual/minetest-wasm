#!/bin/bash -eux

source common.sh

unpack_source openssl

pushd "$BUILD_DIR/openssl"

"$SOURCES_DIR/webshims/src/emsocket/wrap.py" .

patch -p1 < "$BASE_DIR"/openssl.patch

# Ensure OpenSSL picks up emsocket headers (without exposing installed OpenSSL headers)
export CFLAGS="-I${SOURCES_DIR}/webshims/src/emsocket -DPEDANTIC"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-L${INSTALL_DIR}/lib -lemsocket"

emconfigure ./Configure linux-generic64 \
  no-asm \
  no-engine \
  no-hw \
  no-weak-ssl-ciphers \
  no-dtls \
  no-shared \
  no-dso \
  -DPEDANTIC \
  --prefix="$INSTALL_DIR" --openssldir=/ssl

sed -i 's|^CROSS_COMPILE.*$|CROSS_COMPILE=|g' Makefile

emmake make build_generated libssl.a libcrypto.a
cp -r include/openssl "$INSTALL_DIR/include"
cp libcrypto.a libssl.a "$INSTALL_DIR/lib"

echo "openssl OK"
