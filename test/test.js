const {Engine} = require('../lib/index');

exports.startWithDelay = (engine) => {
  return new Promise((resolve) => {
    engine.start()
      .then(() => {
        setTimeout(resolve, 300);
      })
  });
};

exports.stopWithDelay = (engine) => {
  return new Promise((resolve, reject) => {
    try {
      engine.stop();
    } catch (e) {
      reject(e);
      return;
    }
    setTimeout(resolve, 300);
  });
};

exports.testEngine = (path) => {
  path = path || '/graphql';

  // Install middleware before GraphQL handler:
  return new Engine({
    endpoint: path,
    engineConfig: {
      apiKey: 'faked'
    },
    graphqlPort: 1
  });
};
