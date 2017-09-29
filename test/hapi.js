const hapi = require('hapi');
const {graphqlHapi} = require('apollo-server-hapi');

const {assert} = require('chai');
const request = require('request');
const {Engine} = require('../lib/index');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError} = require('./schema');

describe('hapi middleware', () => {
  let server;
  beforeEach(() => {
    server = new hapi.Server();
    server.connection({
      host: 'localhost',
      port: 0
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
    beforeEach((done) => {
      server.start((err) => {
        if (err) {
          throw err;
        }
        url = `http://localhost:${server.info.port}/graphql`;
        done();
      });
    });

    it('processes successful query', (done) => {
      verifyEndpointSuccess(url, true, done);
    });
    it('processes invalid query', (done) => {
      verifyEndpointFailure(url, done);
    });
    it('processes query that errors', (done) => {
      verifyEndpointError(url, done);
    });
  });

  describe('with engine', () => {
    let url;
    beforeEach((done) => {
      // Start server:
      server.start((err) => {
        if (err) {
          throw err;
        }
        let port = server.info.port;
        url = `http://localhost:${port}/graphql`;

        // Then start engine:
        let engine = new Engine({
          engineConfig: {
            apiKey: "faked",
          },
          graphqlPort: port
        });
        engine.instrumentHapiServer(server);
        engine.start();

        // Hack to wait for proxy process to launch and bind:
        setTimeout(done, 100);
      });
    });

    it('processes successful query', (done) => {
      verifyEndpointSuccess(url, false, done);
    });
    it('processes invalid query', (done) => {
      verifyEndpointFailure(url, done);
    });
    it('processes query that errors', (done) => {
      verifyEndpointError(url, done);
    });

    // TODO: validating behaviour when a specific bug is triggered
    // This test is useless in the long term
    it('processes empty request', (done) => {
      request.post({
        url,
        body: ''
      }, function (err, response, body) {
        body = JSON.parse(response.body);
        assert.strictEqual('The query failed!', body['errors'][0]['message']);
        verifyEndpointSuccess(url, false, done);
      });
    });
  });
});
