Minetest-wasm
=============

This is an experimental port of Minetest to the web using emscripten/WebAssembly.

The original repository is from paradust7. This fork has done some work on save game persistence through 
indexeddb storage, and has been created as a proof of concept for embedding a minecraft-like game into 
the social platform Common Ground ([app.cg](https://app.cg), [commonground.cg](https://commonground.cg)) as an in-community plugin, to enable full p2p gameplay. 
The server is hosted in the browser, with persistent save games in indexeddb.

There's an inofficial [Luanti Community](https://app.cg/c/luanti) there, too, where development and 
roadmap can be discussed, and the game can be played there, too.

This build does not use the latest version of Luanti, and not much has been updated in the web assembly 
build pipeline. Anyone who is interested in working on this together is very welcome.

Disclosure: I'm also one of the founders of the Common Ground project, which is [on github](https://github.com/Common-Ground-DAO) too.

No specific Ubuntu version is required for building anymore (as stated in the original README). I've 
added a `build_all_with_docker.sh` script that uses a docker container for building and does not 
have any other specific system requirements (only tested on Linux though 🐧❤️).

I've also added some patches to hook into the saving to disk process, to trigger a synchronization with 
indexeddb right after the save. For my specific use case, local directory sync is not an option since 
it's unavailable in iframes, but it's possible and would probably be the best option for a long-term 
stable Luanti web version.

=============
Original README

System Requirements
-------------------
This has only been tested on Ubuntu 20.04.

* Ubuntu: apt-get install -y build-essential cmake tclsh

Building
---------

    cd minetest-wasm
    ./build_all.sh

Installation
------------

If the build completes successfully, the www/ directory will contain the entire application. This 
includes an `.htaccess` file which sets headers that are required (by browsers) to load the app. 
If your webserver does not recognize `.htaccess` files, you may need to set the headers in
another way.

Network Play
------------

By default, the proxy server is set to `wss://minetest.dustlabs.io/proxy` (see static/launcher.js).
This is necessary for network play, since websites cannot open normal TCP/UDP sockets. This proxy
is located in California. There are regional proxies which may perform better depending on your
location:

North America (Dallas) - wss://na1.dustlabs.io/mtproxy
South America (Sao Paulo) - wss://sa1.dustlabs.io/mtproxy
Europe (Frankfurt) - wss://eu1.dustlabs.io/mtproxy
Asia (Singapore) - wss://ap1.dustlabs.io/mtproxy
Australia (Melbourne) - wss://ap2.dustlabs.io/mtproxy

You could also roll your own own custom proxy server. The client code is here:

https://github.com/paradust7/webshims/blob/main/src/emsocket/proxy.js

Custom Emscripten
-----------------
The Emscripten SDK (emsdk) will be downloaded and installed the first time you build. To provide
your own instead, set $EMSDK before building (e.g. using `emsdk_env.sh`). An external Emscripten
may need to be patched by running this exactly once:

    ./apply_patches.sh /path/to/emsdk
