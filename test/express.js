const http = require('http');
const express = require('express');
const {graphqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');
const {createServer} = require('net');

const request = require('request');
const {assert} = require('chai');

const {Engine} = require('../lib/index');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError} = require('./schema');

describe('express middleware', () => {
  // Start graphql-express on a random port:
  let app;
  beforeEach(() => {
    app = express();
  });

  function gqlServer(path) {
    path = path || '/graphql';
    app.get(`${path}/ping`, (req, res) => {
      res.json({'pong': true});
    });

    app.use(path, bodyParser.json(), graphqlExpress({
      schema: schema,
      rootValue: rootValue,
      tracing: true
    }));

    return http.createServer(app).listen().address().port;
  }

  describe('without engine', () => {
    let url;
    beforeEach(() => {
      port = gqlServer();
      url = `http://localhost:${port}/graphql`;
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
    // Configure engine middleware:
    let engine;
    let url;
    beforeEach(() => {
      engine = new Engine({engineConfig: {
        apiKey: "faked"
      }, graphqlPort: 1});
      // Install middleware before GraphQL handler:
      app.use(engine.expressMiddleware());
      let port = gqlServer();
      engine.graphqlPort = port;
      url = `http://localhost:${port}/graphql`;
    });

    describe('unstarted engine', () => {
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

    describe('engine started', () => {
      // Start engine middleware (i.e. spawn proxy)
      beforeEach((done) => {
        engine.start().then(() => {
          // Really ugly, but delay for proxy process to spawn+bind:
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
    });
  });

  describe('custom path routing', () => {
    it('allows routing root path through proxy', (done) => {
      // Install middleware before GraphQL handler:
      let engine = new Engine({
        endpoint: '/',
        engineConfig: {
          apiKey: "faked",
        },
        graphqlPort: 1
      });
      app.use(engine.expressMiddleware());

      let port = gqlServer('/');
      engine.graphqlPort = port;
      engine.start().then(() => {
        // Really ugly, but delay for proxy process to spawn+bind:
        setTimeout(() => {
          let url = `http://localhost:${port}/`;
          verifyEndpointSuccess(url, false, done);
        }, 100);
      });
    });

    it('does not route child path through proxy', (done) => {
      // Install middleware before GraphQL handler:
      let engine = new Engine({
        endpoint: '/graphql',
        engineConfig: {
          apiKey: "faked"
        },
        graphqlPort: 1
      });
      app.use(engine.expressMiddleware());

      let port = gqlServer();

      // Request direct to server works:
      let url = `http://localhost:${port}/graphql/ping`;
      request.get(url, (err, response, body) => {
        assert.strictEqual('{"pong":true}', body);

        // Integrate engine proxy:
        engine.graphqlPort = port;
        engine.start().then(() => {
          // Really ugly, but delay for proxy process to spawn+bind:
          setTimeout(() => {
            // Same request with middleware installed works:
            request.get(url, (err, response, body) => {
              assert.strictEqual('{"pong":true}', body);
              let url = `http://localhost:${port}/graphql`;
              verifyEndpointSuccess(url, false, done);
            })
          }, 100);
        });
      });
    });
  });

  describe('engine config', () => {
    it('allows reading from file proxy', (done) => {
      // Install middleware before GraphQL handler:
      let engine = new Engine({
        endpoint: '/graphql',
        engineConfig: 'test/engine.json',
        graphqlPort: 1
      });
      app.use(engine.expressMiddleware());

      let port = gqlServer('/graphql');
      engine.graphqlPort = port;
      engine.start().then(() => {
        // Really ugly, but delay for proxy process to spawn+bind:
        setTimeout(() => {
          let url = `http://localhost:${port}/graphql`;
          verifyEndpointSuccess(url, false, done);
        }, 100);
      });
    });

    it('appends configuration', (done) => {
      // Grab a random port locally:
      const srv = createServer();
      srv.on('listening', () => {
        const extraPort = srv.address().port;
        srv.close();

        // Setup engine, with an extra frontend on that port:
        let engine = new Engine({
          endpoint: '/graphql',
          engineConfig: {
            apiKey: "faked",
            frontends: [{
              host: '127.0.0.1',
              endpoint: '/graphql',
              port: extraPort
            }]
          },
          graphqlPort: 1
        });
        app.use(engine.expressMiddleware());

        let port = gqlServer('/graphql');
        engine.graphqlPort = port;
        engine.start().then(() => {
          setTimeout(() => {
            let url = `http://localhost:${port}/graphql`;
            verifyEndpointSuccess(`http://localhost:${port}/graphql`, false, () => {
              verifyEndpointSuccess(`http://localhost:${extraPort}/graphql`, false, done);
            });
          }, 100);
        });
      }).listen(0)
    });
  });
});
