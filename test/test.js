const {Engine} = require('../lib/index');

exports.testEngine = (path) => {
  path = path || '/graphql';

  return new Engine({
    endpoint: path,
    engineConfig: {
      apiKey: 'faked',
      logging: {
        level: 'warn'
      },
    },
    graphqlPort: 1,
    frontend: {
      extensions: {
        strip: ['tracing'],
      }
    }
  });
};
