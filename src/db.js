const PouchDB = require('pouchdb');
const PouchDBWorker = require('worker-pouch/client');

const pushPublicKey = 'BOk9sise2ar9fqix9rnuwtJpJz3JygBbkGKxK-4ObfWXQI-HEox-JmtaoLNSm3idLEjuuUFW-tzPShE_jmSoTSA';

module.exports = class {

  setup() {
    console.log('constructing DB');
    return this.createDB().then((db) => {
      console.log('done creating DB');
      this.localDB = db;
      this.setupSubscription();
      return db;
    });
  }

  createDB() {
    console.log('about to create DB');
    return navigator.serviceWorker.ready.then(() => {
      console.log('SW READY!!!');
      if (navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage) {
        PouchDB.adapter('worker', PouchDBWorker);
        let localDB = new PouchDB('localMessages', {
          adapter: 'worker',
          worker: () => navigator.serviceWorker
        });
        return localDB;
      }
      if (navigator.serviceWorker.controller && !navigator.serviceWorker.controller.postMessage) {
        console.log('Cannot setup DB because postMessage is not available');
      } else {
        console.log('Cannot setup DB because service worker controller is not available');
      }
      return null;
    });
  }

  requestSync() {
    return new Promise((resolve, reject) => {
      let messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        if (event.data.error) {
          reject(event.data.error);
        } else {
          resolve(event.data);
        }
      };
      navigator.serviceWorker.controller.postMessage('remotesync', [messageChannel.port2]);
    }, 'Request offline sync');
  }

  _askPermission() {
    return new Promise((resolve, reject) => {
      let permissionResult = Notification.requestPermission((result) => {
        resolve(result);
      });

      if (permissionResult) {
        permissionResult.then(resolve, reject);
      }
    })
    .then((permissionResult) => {
      if (permissionResult !== 'granted') {
        throw new Error('We weren\'t granted permission.');
      }
      return permissionResult;
    }, 'Ask for notification permisson');
  }

  _getNotificationPermissionState() {
    if (navigator.permissions) {
      return navigator.permissions.query({ name: 'notifications' })
      .then((result) => {
        return result.state;
      });
    }
    return Promise.resolve(Notification.permission);
  }

  _getConfigValue(key) {
    return this.localDB.get(`_local/${key}`);
  }

  _getPermissionAndSubscribe(dbInfo) {
    console.log('IN _getPermissionAndSubscribe');
    return new Promise((resolve, reject) => {
      navigator.serviceWorker.ready.then((registration) => {
        console.log('IN _getPermissionAndSubscribe, serviceWorker ready');
        return this._getNotificationPermissionState().then((permission) => {
          if (permission !== 'granted') {
            return this._askPermission().then(() => {
              return this._subscribeUserToPush(registration, dbInfo).then(resolve, reject);
            });
          }
          return this._subscribeUserToPush(registration, dbInfo).then(resolve, reject);
        });
      });
    }, 'Get notification permission and subscribe to push');
  }

  _urlBase64ToUint8Array(base64String) {
    let padding = '='.repeat((4 - base64String.length % 4) % 4);
    let base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    let rawData = window.atob(base64);
    let outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  _sendSubscriptionToServer(subscription, dbInfo) {
    return new Promise((resolve, reject) => {
      return fetch('/save-subscription/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dbInfo,
          subscription
        })
      }).then((response) => {
        if (!response.ok) {
          throw new Error('Bad status code from server.');
        }
        return response.json();
      }).then((responseData) => {
        if (responseData.ok !== true) {
          throw new Error('There was a bad response from server.', JSON.stringify(responseData, null, 2));
        }
        resolve(responseData);
      }).catch(reject);
    }, 'Send push subscription to server');
  }

  setupSubscription() {
    console.log('In setup subscription');
    if (navigator.serviceWorker) {
      console.log('In setup subscription, about to check if value exists.');
      return this.localDB.get('_local/push_subscription').catch(() => {
        console.log('No subscription, so go figure it out');
        return this.localDB.id().then((dbId) => {
          let dbInfo = {
            id: dbId,
            remoteSeq: 0
          };
          return this._getPermissionAndSubscribe(dbInfo);
        }).then((subinfo) => {
          console.log('We are subscribed', subinfo);
          return this.requestSync();
        });
      }).then((subinfo) => {
        console.log('We have subinfo', subinfo);
        return this.requestSync();
      });
    }
  }
  _subscribeUserToPush(registration, dbInfo) {
    console.log('IN _subscribeUserToPush');
    let subscribeOptions = {
      userVisibleOnly: true,
      applicationServerKey: this._urlBase64ToUint8Array(pushPublicKey)
    };
    return new Promise((resolve, reject) => {
      return registration.pushManager.subscribe(subscribeOptions)
      .then((pushSubscription) => {
        console.log('IN _subscribeUserToPush, got subscription');
        let subInfo = JSON.stringify(pushSubscription);
        subInfo = JSON.parse(subInfo);
        return this._sendSubscriptionToServer(subInfo, dbInfo);
      }).then((savedSubscription) => {
        console.log('IN _subscribeUserToPush, server saved subscription, trying to save locally');
        return this.localDB.put({
          _id: '_local/push_subscription',
          value: savedSubscription.id
        }).then((saveResults) => {
          console.log('Saved subscription to local db', saveResults);
          resolve(saveResults);
        }).catch((err) => {
          console.log('Error saving subscription to local db', err);
          reject(err);
        });
      }).catch((err) => {
        console.log('Error _subscribeUserToPush', err);
        return this.localDB.put({
          _id: '_local/push_subscription',
          value: false,
          reason: err
        });
      });
    });
  }

};
