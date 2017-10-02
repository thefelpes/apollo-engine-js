const {Engine} = require('../lib/index');

exports.startWithDelay = (engine) => {
  return new Promise((resolve) => {
    engine.start()
      .then(() => {
        setTimeout(resolve, 100);
      })
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
