var Module = typeof Module != "undefined" ? Module : {};

Module['print'] = (text) => {
  postMessage({cmd: 'callHandler', handler: 'print', args: [text]});
  // postMessage({cmd: 'callHandler', handler: 'print', args: [text], threadId: Module['_pthread_self']()});
};

Module['printErr'] = (text) => {
  postMessage({cmd: 'callHandler', handler: 'printErr', args: [text]});
  // postMessage({cmd: 'callHandler', handler: 'printErr', args: [text], threadId: Module['_pthread_self']()});
};

importScripts('minetest.js');
