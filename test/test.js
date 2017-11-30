const {Engine} = require('../lib/index');

exports.testEngine = (path) => {
  path = path || '/graphql';

  // Install middleware before GraphQL handler:
  return new Engine({
    endpoint: path,
    engineConfig: {
      apiKey: 'faked',
      logging: {
        level: 'warn'
      },
    },
    graphqlPort: 1
  });
};
