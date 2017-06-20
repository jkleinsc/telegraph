const Db = require('./db');

module.exports = class {
  setup(swPath, swScope) {
    if ('serviceWorker' in navigator) {
      window.addEventListener('online', event => this._updateOnlineStatus(event));
      window.addEventListener('offline', event => this._updateOnlineStatus(event));

      navigator.serviceWorker.register(swPath, { scope: swScope }).then((res) => {
        console.log('Success registering serviceworker', res);
      }).catch((error) => {
        console.error('Error registering service worker', error);
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
      navigator.serviceWorker.addEventListener('message', event => this._handleSwMessage(event));
      this.db = new Db();
      this.db.setup({}).then((messagesDb) => {
        console.log('DB SETUP DONE', messagesDb);
        this.messagesDb = messagesDb;
        this._getAllMessages();
        let addButton = document.getElementById('addButton');
        addButton.addEventListener('click', () => this._addMessage());
        let syncButton = document.getElementById('syncButton');
        syncButton.addEventListener('click', () => this._requestSync());
      }).catch((err) => {
        console.error('Error initializing database', err);
      });
    } else {
      console.log('service worker not supported');
    }
  }

  _addMessage() {
    let newMessage = document.getElementById('postMessage');
    let datePosted = new Date();
    let messageId = `${datePosted.getTime()}_${Math.floor(Math.random() * 1000)}`;
    let newMessageDoc = {
      _id: messageId,
      message: newMessage.value,
      datePosted: new Date()
    };
    this.messagesDb.put(newMessageDoc).then(() => {
      newMessage.value = '';
      this._addMessageToList(newMessageDoc);
    });
  }

  _addMessageToList(message, messageList) {
    if (!messageList) {
      messageList = document.getElementById('messageList');
    }
    let existingMessage = document.getElementById(message._id);
    if (!existingMessage) {
      let li = document.createElement('li');
      li.setAttribute('id', message._id);
      li.className = 'list-group-item';
      let span = document.createElement('span');
      span.className = this._getClassForSpan(message);
      let emptySpace = document.createTextNode(' ');
      span.appendChild(emptySpace);
      li.appendChild(span);
      let text = document.createTextNode(message.message);
      li.appendChild(text);
      let firstMessage = messageList.firstChild;
      messageList.insertBefore(li, firstMessage);
    }
  }

  _getAllMessages() {
    let messageList = document.getElementById('messageList');
    this.messagesDb.allDocs({ include_docs: true }).then((messages) => {
      messages.rows.forEach((message) => {
        this._addMessageToList(message.doc, messageList);
      });
    }).catch((err) => {
      console.error('Error getting messages', err);
    });
  }

  _getClassForSpan(message) {
    let classNames = [
      'badge',
      'glyphicon'
    ];
    if (message._rev) {
      classNames.push('alert-success');
      classNames.push('glyphicon-saved');
    } else {
      classNames.push('alert-warning');
      classNames.push('glyphicon-open');
    }
    return classNames.join(' ');
  }

  _handleSwMessage(event) {
    let message = event.data;
    if (message.type === 'remotesync') {
      if (message.success) {
        this._setOnlineStatus(true);
        this._getAllMessages();
        let messageList = document.getElementById('messageList');
        let icons = messageList.getElementsByClassName('badge');
        Array.prototype.forEach.call(icons, (icon) => {
          icon.className = icon.className.replace('alert-warning', 'alert-success');
          icon.className = icon.className.replace('glyphicon-open', 'glyphicon-saved');
        });
      } else {
        this._setOnlineStatus(false);
      }
    }
  }

  _requestSync() {
    this.db.requestSync();
  }

  _setOnlineStatus() {
    let onlineStateEl = document.getElementById('onlineState');
    if (navigator.onLine) {
      onlineStateEl.className = onlineStateEl.className.replace('label-warning', 'label-success');
      onlineStateEl.lastChild.textContent = ' Online';
    } else {
      onlineStateEl.className = onlineStateEl.className.replace('label-success', 'label-warning');
      onlineStateEl.lastChild.textContent = ' Offline';
    }
  }

  _updateOnlineStatus() {
    this._setOnlineStatus(navigator.online);
  }
};
