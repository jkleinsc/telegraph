const PouchDB = require('pouchdb-core')
  .plugin(require('pouchdb-adapter-idb'))
  .plugin(require('pouchdb-adapter-http'))
  .plugin(require('pouchdb-mapreduce'))
  .plugin(require('pouchdb-replication'));

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.log('Hey in SW activate - Trying to setup all the things');
  event.waitUntil(self.clients.claim()); // activate right now
});


const allChanges = {};
let syncingRemote = false;
let localMainDB = new PouchDB('localMessages');
let lastServerSeq;


function logDebug(logStatement, ...args) {
  if (arguments.length > 1) {
    console.log(logStatement, args);
  } else {
    console.log(logStatement);
  }
}

function PouchError(opts) {
  Error.call(opts.reason);
  this.status = opts.status;
  this.name = opts.error;
  this.message = opts.reason;
  this.error = true;
}

function createError(err) {
  let status = err.status || 500;

  // last argument is optional
  if (err.name && err.message) {
    if (err.name === 'Error' || err.name === 'TypeError') {
      if (err.message.indexOf('Bad special document member') !== -1) {
        err.name = 'doc_validation';
        // add more clauses here if the error name is too general
      } else {
        err.name = 'bad_request';
      }
    }
    err = {
      error: err.name,
      name: err.name,
      reason: err.message,
      message: err.message,
      status
    };
  }
  return err;
}

function safeEval(str) {
  let target = {};
  /* eslint no-eval: 0 */
  eval(`target.target = (${str});`);
  return target.target;
}

function decodeArgs(args) {
  let funcArgs = ['filter', 'map', 'reduce'];
  args.forEach((arg) => {
    if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      funcArgs.forEach((funcArg) => {
        if (!(funcArg in arg) || arg[funcArg] === null) {
          delete arg[funcArg];
        } else if (arg[funcArg].type === 'func' && arg[funcArg].func) {
          arg[funcArg] = safeEval(arg[funcArg].func);
        }
      });
    }
  });
  return args;
}

function postMessage(msg, event) {
  event.ports[0].postMessage(msg);
}

function sendError(clientId, messageId, data, event) {
  postMessage({
    type: 'error',
    id: clientId,
    messageId,
    content: createError(data)
  }, event);
}

function sendSuccess(clientId, messageId, data, event) {
  logDebug(' -> sendSuccess', clientId, messageId);
  postMessage({
    type: 'success',
    id: clientId,
    messageId,
    content: data
  }, event);
}

function sendUpdate(clientId, messageId, data, event) {
  logDebug(' -> sendUpdate', clientId, messageId);
  postMessage({
    type: 'update',
    id: clientId,
    messageId,
    content: data
  }, event);
}

function getCurrentDB(clientId) {
  return Promise.resolve(new PouchDB(clientId));
}

function getRemoteDB() {
  let remoteURL = 'http://localhost:3000/db/messages';
  return new PouchDB(remoteURL);
}

function updateSubscription(lastSeq) {
  localMainDB.get('_local/push_subscription').then((subinfo) => {
    if (subinfo.value !== false) {
      // Update push subscription with latest sync info
      fetch('http://localhost:3000/update-subscription/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriptionId: subinfo.value,
          remoteSeq: lastSeq
        })
      });
    }
  }).catch((err) => {
    console.log('Subscription info not available and will not be updated.', err);
  });
}

function notifyRemoteSync(success) {
  clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      let messageChannel = new MessageChannel();
      client.postMessage({
        type: 'remotesync',
        success
      }, [messageChannel.port2]);
    });
  });
}

function remoteSync(remoteSequence, retryingSync) {
  lastServerSeq = remoteSequence;
  if (!syncingRemote) {
    logDebug(`Synching local db to remoteSequence: ${remoteSequence} at: ${new Date()}`);
    syncingRemote = true;
    let remoteDB = getRemoteDB();
    return localMainDB.sync(remoteDB).then((info) => {
      syncingRemote = false;
      logDebug('local sync complete:', info);
      updateSubscription(info.pull.last_seq);
      // handle complete
      if (info.pull.last_seq < lastServerSeq) {
        return remoteSync(lastServerSeq);
      }
      notifyRemoteSync(true);
      return true;
    }).catch((err) => {
      notifyRemoteSync(false);
      syncingRemote = false;
      logDebug(`local sync error, register remote sync: ${new Date()}`, err);
      if (retryingSync) {
        throw err;
      } else {
        self.registration.sync.register('remoteSync').then((res) => {
          console.log('Successfully registered for background sync', res);
        }).catch((err) => {
          console.log('Error registering for background sync', err);
        });
      }
    });
  }
  if (syncingRemote) {
    logDebug(`Skipping sync to: ${remoteSequence} because sync is in process`);
  }
  return Promise.resolve(false);
}

function dbMethod(clientId, methodName, messageId, args, event) {
  return getCurrentDB(clientId).then((db) => {
    if (!db) {
      return sendError(clientId, messageId, { error: 'db not found' }, event);
    }
    return db[methodName](...args);
  }).then((res) => {
    sendSuccess(clientId, messageId, res, event);
    switch (methodName) {
      case 'put':
      case 'bulkDocs':
      case 'post':
      case 'remove':
      case 'removeAttachment':
      case 'putAttachment':
        remoteSync();
        break;
      default:
    }
  }).catch((err) => {
    sendError(clientId, messageId, err, event);
  });
}

function changes(clientId, messageId, args, event) {
  let [opts] = args;
  if (opts && typeof opts === 'object') {
    // just send all the docs anyway because we need to emit change events
    // TODO: be smarter about emitting changes without building up an array
    opts.returnDocs = true;
    opts.return_docs = true;
  }
  dbMethod(clientId, 'changes', messageId, args, event);
}

function createDatabase(clientId, messageId, args, event) {
  return sendSuccess(clientId, messageId, { ok: true, exists: true }, event);
}

function getAttachment(clientId, messageId, args, event) {
  return getCurrentDB(clientId).then((db) => {
    if (!db) {
      return sendError(clientId, messageId, { error: 'db not found' }, event);
    }
    let [docId, attId, opts] = args;
    if (typeof opts !== 'object') {
      opts = {};
    }
    return db.get(docId, opts).then((doc) => {
      if (!doc._attachments || !doc._attachments[attId]) {
        throw new PouchError({
          status: 404,
          error: 'not_found',
          reason: 'missing'
        });
      }
      return db.getAttachment(...args).then((buff) => {
        sendSuccess(clientId, messageId, buff, event);
      });
    });
  }).catch((err) => {
    sendError(clientId, messageId, err, event);
  });
}

function destroy(clientId, messageId, args, event) {
  return getCurrentDB(clientId).then((db) => {
    if (!db) {
      return sendError(clientId, messageId, { error: 'db not found' }, event);
    }
    return Promise.resolve().then(() => {
      return db.destroy(...args);
    }).then((res) => {
      sendSuccess(clientId, messageId, res, event);
    }).catch((err) => {
      sendError(clientId, messageId, err, event);
    });
  });
}

function liveChanges(clientId, messageId, args, event) {
  return getCurrentDB(clientId).then((db) => {
    if (!db) {
      return sendError(clientId, messageId, { error: 'db not found' }, event);
    }
    let changes = db.changes(args[0]);
    allChanges[messageId] = changes;
    return changes.on('change', (change) => {
      sendUpdate(clientId, messageId, change, event);
    }).on('complete', (change) => {
      changes.removeAllListeners();
      delete allChanges[messageId];
      sendSuccess(clientId, messageId, change, event);
    }).on('error', (change) => {
      changes.removeAllListeners();
      delete allChanges[messageId];
      sendError(clientId, messageId, change, event);
    });
  });
}

function cancelChanges(messageId) {
  let changes = allChanges[messageId];
  if (changes) {
    changes.cancel();
  }
}

function onReceiveMessage(clientId, type, messageId, args, event) {
  switch (type) {
    case 'createDatabase':
      return createDatabase(clientId, messageId, args, event);
    case 'id':
      return sendSuccess(clientId, messageId, clientId, event);
    case 'info':
    case 'put':
    case 'allDocs':
    case 'bulkDocs':
    case 'post':
    case 'get':
    case 'remove':
    case 'revsDiff':
    case 'compact':
    case 'viewCleanup':
    case 'removeAttachment':
    case 'putAttachment':
    case 'query':
      return dbMethod(clientId, type, messageId, args, event);
    case 'changes':
      return changes(clientId, messageId, args, event);
    case 'getAttachment':
      return getAttachment(clientId, messageId, args, event);
    case 'liveChanges':
      return liveChanges(clientId, messageId, args, event);
    case 'cancelChanges':
      return cancelChanges(messageId);
    case 'destroy':
      return destroy(clientId, messageId, args, event);
    default:
      return sendError(clientId, messageId, { error: `unknown API method: ${type}` }, event);
  }
}

function handleMessage(message, clientId, event) {
  let { type, messageId } = message;
  let args = decodeArgs(message.args);
  onReceiveMessage(clientId, type, messageId, args, event);
}

self.addEventListener('push', (event) => {
  if (event.data) {
    let pushData = event.data.json();
    if (pushData.type === 'couchDBChange') {
      logDebug(`Got couchDBChange pushed, attempting to sync to: ${pushData.seq}`);
      event.waitUntil(
        remoteSync(pushData.seq).then((resp) => {
          logDebug(`Response from sync ${JSON.stringify(resp, null, 2)}`);
        })
      );
    } else {
      logDebug('Unknown push event has data and here it is: ', pushData);
    }
  }
});

self.addEventListener('message', (event) => {
  logDebug('got message', event);
  if (event.data === 'remotesync') {
    remoteSync();
    return;
  }
  if (!event.data || !event.data.id || !event.data.args
      || !event.data.type || !event.data.messageId) {
    // assume this is not a message from worker-pouch
    // (e.g. the user is using the custom API instead)
    return;
  }
  let clientId = event.data.id;
  if (event.data.type === 'close') {
    // logDebug('closing worker', clientId);
  } else {
    handleMessage(event.data, clientId, event);
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'remoteSync') {
    event.waitUntil(remoteSync().catch((err) => {
      if (event.lastChance) {
        logDebug('Sync failed for the last time, so give up for now.', err);
      } else {
        logDebug('Sync failed, will try again later', err);
      }
    }));
  }
});
