const http = require('http');
const express = require('express');
const {graphqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');
const {createServer} = require('net');

const request = require('request-promise-native');
const {assert} = require('chai');

const {Engine} = require('../lib/index');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError} = require('./schema');
const {startWithDelay} = require('./test');

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

  function setupEngine(path) {
    path = path || '/graphql';

    // Install middleware before GraphQL handler:
    let engine = new Engine({
      endpoint: path,
      engineConfig: {
        apiKey: 'faked'
      },
      graphqlPort: 1
    });
    app.use(engine.expressMiddleware());

    engine.graphqlPort = gqlServer(path);
    return engine;
  }

  describe('without engine', () => {
    let url;
    beforeEach(() => {
      url = `http://localhost:${gqlServer()}/graphql`;
    });

    it('processes successful query', () => {
      return verifyEndpointSuccess(url, true)
    });
    it('processes invalid query', () => {
      return verifyEndpointFailure(url);
    });
    it('processes query that errors', () => {
      return verifyEndpointError(url);
    });
  });

  describe('with engine', () => {
    // Configure engine middleware:
    let engine;
    let url;
    beforeEach(() => {
      engine = setupEngine();
      url = `http://localhost:${engine.graphqlPort}/graphql`;
    });

    describe('unstarted engine', () => {
      it('processes successful query', () => {
        return verifyEndpointSuccess(url, true);
      });
      it('processes invalid query', () => {
        return verifyEndpointFailure(url);
      });
      it('processes query that errors', () => {
        return verifyEndpointError(url);
      });
    });

    describe('engine started', () => {
      // Start engine middleware (i.e. spawn proxy)
      beforeEach(async () => {
        await startWithDelay(engine);
      });

      it('processes successful query', () => {
        return verifyEndpointSuccess(url, false);
      });
      it('processes invalid query', () => {
        return verifyEndpointFailure(url);
      });
      it('processes query that errors', () => {
        return verifyEndpointError(url);
      });
    });
  });

  describe('custom path routing', () => {
    it('allows routing root path through proxy', async () => {
      let engine = setupEngine('/');
      await startWithDelay(engine);
      return verifyEndpointSuccess(`http://localhost:${engine.graphqlPort}/`, false);
    });


    it('does not route child path through proxy', async () => {
      let engine = setupEngine();

      // Request direct to server works:
      let childUrl = `http://localhost:${engine.graphqlPort}/graphql/ping`;
      let childDirect = await request.get(childUrl);
      assert.strictEqual('{"pong":true}', childDirect);

      // Start engine proxy:
      await startWithDelay(engine);

      // Same request with middleware installed works:
      let childThroughProxy = await request.get(childUrl);
      assert.strictEqual('{"pong":true}', childThroughProxy);

      // GraphQL through proxy works too:
      return verifyEndpointSuccess(`http://localhost:${engine.graphqlPort}/graphql`, false);
    });
  });

  describe('engine config', () => {
    it('allows reading from file proxy', async () => {
      // Install middleware before GraphQL handler:
      let engine = new Engine({
        endpoint: '/graphql',
        engineConfig: 'test/engine.json',
        graphqlPort: 1
      });
      app.use(engine.expressMiddleware());

      let port = gqlServer('/graphql');
      engine.graphqlPort = port;

      await startWithDelay(engine);
      return verifyEndpointSuccess(`http://localhost:${port}/graphql`, false);
    });

    it('appends configuration', (done) => {
      // Grab a random port locally:
      const srv = createServer();
      srv.on('listening', async () => {
        const extraPort = srv.address().port;
        srv.close();

        // Setup engine, with an extra frontend on that port:
        let engine = new Engine({
          endpoint: '/graphql',
          engineConfig: {
            apiKey: 'faked',
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
        await startWithDelay(engine);
        await verifyEndpointSuccess(`http://localhost:${port}/graphql`, false);
        await verifyEndpointSuccess(`http://localhost:${extraPort}/graphql`, false);
        done();
      }).listen(0)
    });
  });
});
