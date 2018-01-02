const Hapi = require('hapi');
const {graphqlHapi} = require('apollo-server-hapi');

const {assert} = require('chai');
const request = require('request-promise-native');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError, verifyEndpointGet} = require('./schema');
const {testEngine} = require('./test');

describe('hapi middleware', () => {
  let server;

  async function StartServer() {
      server = new Hapi.server({
          host: 'localhost',
          port: 0,
      });

      await server.register({
          plugin: graphqlHapi,
          options: {
              path: '/graphql',
              graphqlOptions: {
                  schema,
                  rootValue,
                  tracing: true,
              },
          },
      });

      server.route({
        method: 'OPTIONS',
        path: '/graphql',
        handler: (req, h) => {
          return 'ok';
        }
      });

      try {
          await server.start();
      } catch (err) {
          console.log(`Error while starting server: ${err.message}`);
      }

      console.log(`Server running at: ${server.info.uri}`);
  }

  describe('without engine', () => {
    let url;
    beforeEach(async () => {
      await StartServer();
      url = `http://localhost:${server.info.port}/graphql`;
    });

    it('processes successful query', () => {
      return verifyEndpointSuccess(url, true);
    });
    it('processes successful GET query', () => {
      return verifyEndpointGet(url, true);
    });
    it('processes invalid query', () => {
      return verifyEndpointFailure(url);
    });
    it('processes query that errors', () => {
      return verifyEndpointError(url);
    });
  });

  describe('with engine', () => {
    let url, engine;
    beforeEach(async () => {
      await StartServer();
      url = `http://localhost:${server.info.port}/graphql`;

      // Then start engine:
      engine = testEngine();
      engine.graphqlPort = server.info.port;
      engine.instrumentHapiServer(server);
      await engine.start();
    });

    afterEach(async () => {
      engine.stop();
    });

    it('processes successful query', () => {
      return verifyEndpointSuccess(url, false);
    });
    it('processes successful GET query', () => {
      return verifyEndpointGet(url, false);
    });
    it('processes invalid query', () => {
      return verifyEndpointFailure(url);
    });
    it('processes query that errors', () => {
      return verifyEndpointError(url);
    });

    it('ignores options request', async () => {
      let response = await request({
        method: 'OPTIONS',
        url
      });
      assert.strictEqual('ok', response);
    });
  });
});
