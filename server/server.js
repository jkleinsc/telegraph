const PouchDB = require('pouchdb');
const bodyParser = require('body-parser');
const express = require('express');
const expressPouch = require('express-pouchdb')(PouchDB);
const webpush = require('web-push');

const jsonParser = bodyParser.json();

const config = {
  pushContactInfo: 'mailto:foo@email.com',
  pushPublicKey: 'BOk9sise2ar9fqix9rnuwtJpJz3JygBbkGKxK-4ObfWXQI-HEox-JmtaoLNSm3idLEjuuUFW-tzPShE_jmSoTSA',
  pushPrivateKey: '8PcodlLqUw5x74yd28-yfQ7Ig-1mzAN1tQeAfHIV9j0',
  serverPort: 3000
};

const app = express();

app.use(express.static('public'));

app.use('/bootstrap', express.static('../node_modules/bootstrap/dist/'));

app.use('/db', expressPouch);

const messagesDB = new PouchDB('messages');
const pushDB = new PouchDB('pushinfo');

function returnError(message, code, res) {
  res.status(code);
  res.send(JSON.stringify({
    error: message
  }));
}

app.post('/save-subscription/', jsonParser, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!req.body || !req.body.subscription.endpoint) {
    returnError('Bad subscription', 400, res);
  } else {
    let subInfo = req.body;
    pushDB.post(subInfo).then((body) => {
      res.send(JSON.stringify(body));
    }).catch((err) => {
      console.log('Error saving subscription:', err);
      returnError('Unable to save subscription', 500, res);
    });
  }
});

app.post('/update-subscription/', jsonParser, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!req.body || !req.body.remoteSeq || !req.body.subscriptionId) {
    returnError(`Invalid request: ${JSON.stringify(req.body, null, 2)}`, 400, res);
  } else {
    pushDB.get(req.body.subscriptionId).then((subscription) => {
      if (subscription.dbInfo.remoteSeq < req.body.remoteSeq) {
        subscription.dbInfo.remoteSeq = req.body.remoteSeq;
        pushDB.post(subscription).then((saveResponse) => {
          res.send(JSON.stringify(saveResponse));
        }).catch((err) => {
          console.log('Error updating subscription:', err);
          returnError('Unable to update subscription', 500, res);
        });
      } else {
        res.send({ ok: true });
      }
    }).catch((err) => {
      console.log(`Could not find subscription: ${req.body.subscriptionId}`, err);
      returnError('Invalid request', 400, res);
    });
  }
});

if (config.pushContactInfo && config.pushPublicKey && config.pushPrivateKey) {
  webpush.setVapidDetails(
    config.pushContactInfo,
    config.pushPublicKey,
    config.pushPrivateKey
  );

  messagesDB.changes({
    since: 'now',
    live: true,
    include_docs: true
  }).on('change', (change) => {
    pushDB.allDocs({ include_docs: true }).then((subscriptions) => {
      subscriptions.rows.forEach((subscriptionInfo) => {
        if (subscriptionInfo.doc && subscriptionInfo.doc.dbInfo &&
            subscriptionInfo.doc.dbInfo.remoteSeq < change.seq) {
          let notificationInfo = JSON.stringify({
            seq: change.seq,
            type: 'couchDBChange'
          });
          webpush.sendNotification(subscriptionInfo.doc.subscription, notificationInfo)
          .catch((err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              pushDB.remove(subscriptionInfo.doc._id, subscriptionInfo.doc._rev).catch((err) => {
                console.error('Error removing old subscription', err);
              });
            } else {
              console.error('Subscription is no longer valid: ', err);
            }
          });
        }
      });
    }).catch((err) => {
      console.error('Error getting subscriptions to push changes to', err);
    });
  });
}

app.listen(config.serverPort);
console.log(`Telegraph server running on port ${config.serverPort}`);
