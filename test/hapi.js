const hapi = require('hapi');
const {graphqlHapi} = require('apollo-server-hapi');

const {assert} = require('chai');
const request = require('request-promise-native');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError, verifyEndpointGet} = require('./schema');
const {testEngine} = require('./test');

describe('hapi middleware', () => {
  let server;
  beforeEach(() => {
    server = new hapi.Server();
    server.connection({
      host: 'localhost',
      port: 0
    });

    server.route({
      method: 'OPTIONS',
      path: '/graphql',
      handler: (req, reply) => {
        return reply('ok');
      }
    });
    server.register({
      register: graphqlHapi,
      options: {
        path: '/graphql',
        graphqlOptions: {
          schema: schema,
          rootValue: rootValue,
          tracing: true
        }
      },
    });
  });

  describe('without engine', () => {
    let url;
    beforeEach(async () => {
      await server.start();
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
      await server.start();

      let port = server.info.port;
      url = `http://localhost:${port}/graphql`;

      // Then start engine:
      engine = testEngine();
      engine.graphqlPort = port;
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
