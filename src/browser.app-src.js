const App = require('./app');

let app = new App();
app.setup('service-worker.js', '/');
