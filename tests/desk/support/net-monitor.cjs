// A network monitor for a child process, loaded with `node --require`. It records every attempt to open a socket and every name lookup, with the
// destination, in the file named by DESK_NET_LOG, one JSON line each. It records at the call, before any packet is sent, so a connection that
// would have been refused or have timed out is still seen. It changes nothing: every call goes on to the real function.
"use strict";
const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns");
const dgram = require("node:dgram");

const out = process.env.DESK_NET_LOG;
function note(kind, target) {
  if (!out) return;
  try {
    fs.appendFileSync(out, JSON.stringify({ kind, target, pid: process.pid }) + "\n");
  } catch {
    /* the monitor must not break the process it watches */
  }
}

function targetOf(args) {
  // Node's own `net.connect` hands the socket its arguments already normalised, as an array whose first item is the options.
  if (Array.isArray(args[0])) args = args[0];
  const a0 = args[0];
  if (a0 && typeof a0 === "object") {
    if (a0.path) return "ipc:" + a0.path;
    return String(a0.host || "localhost") + ":" + String(a0.port);
  }
  if (typeof a0 === "number" || (typeof a0 === "string" && /^\d+$/.test(a0))) return (typeof args[1] === "string" ? args[1] : "localhost") + ":" + a0;
  return "ipc:" + String(a0);
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  note("connect", targetOf(args));
  return connect.apply(this, args);
};

for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) {
  const real = dns[name];
  if (typeof real !== "function") continue;
  dns[name] = function (host, ...rest) {
    note("dns", String(host));
    return real.call(this, host, ...rest);
  };
}

const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  note("udp", "send");
  return send.apply(this, args);
};
