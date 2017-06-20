# telegraph
Simple social media app demonstrating syncing PouchDB with service workers.  This application demonstrates the following:
1. Using [worker-pouch](https://github.com/pouchdb-community/worker-pouch) to run PouchDB inside a service worker.
2. Using the [Push API](https://web-push-book.gauntface.com/) to synchronize server side database changes to each client.
3. Using the [Background Sync API](https://ponyfoo.com/articles/backgroundsync) to synchronize offline local changes once the user has network connectivity.
4. [Electron's](https://electron.atom.io/) capabilities using Service Workers, the Push API, and background sync.  At present Electron does not support the Push API or the Background Sync API.

## Installing
1. Run `npm install`
2. If you also want to run the Electron app:
   * `cd electron`
   * `npm install`


## Running the application
1. Run `npm start` to start the server.  Once the server is up and running a message will display in the console: *Telegraph server running on port 3000*
2. Go to http://localhost:3000 in a browser
3. If you want to run the Electron app:
   * Make sure the server (#1) is running
   * `cd electron`
   * `npm start`
