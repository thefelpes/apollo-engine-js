const http = require('http');
const express = require('express');
const {graphqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');

const request = require('request-promise-native');
const {assert} = require('chai');
const isRunning = require('is-running');

const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError, verifyEndpointGet, verifyEndpointBatch} = require('./schema');
const {testEngine} = require('./test');

describe('express middleware', () => {
  // Start graphql-express on a random port:
  let app, engine = null;
  beforeEach(() => {
    app = express();
  });
  afterEach(async () => {
    if (engine) {
      if (engine.started) {
        const pid = engine.child.pid;
        await engine.stop();
        assert.isFalse(isRunning(pid));
      }
      engine = null;
    }
  });

  function gqlServer(path) {
    path = path || '/graphql';
    app.get(`${path}/ping`, (req, res) => {
      res.json({'pong': true});
    });

    app.use(path, bodyParser.json(), graphqlExpress({
      schema,
      rootValue,
      tracing: true,
      cacheControl: true,
    }));

    return http.createServer(app).listen().address().port;
  }

  function setupEngine(path) {
    engine = testEngine(path);
    if (path) {
      app.use(path, engine.expressMiddleware());
    } else {
      app.use(engine.expressMiddleware());
    }

    engine.graphqlPort = gqlServer(path);
  }

  describe('without engine', () => {
    let url;
    beforeEach(() => {
      url = `http://localhost:${gqlServer()}/graphql`;
    });

    it('processes successful query', () => {
      return verifyEndpointSuccess(url, true)
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
    it('returns cache information', async () => {
      const body = await verifyEndpointSuccess(url, true);
      assert.notEqual(undefined, body['extensions'] && body['extensions']['cacheControl']);
    });
  });

  describe('with engine', () => {
    // Configure engine middleware:
    let url;
    beforeEach(() => {
      setupEngine();
      url = `http://localhost:${engine.graphqlPort}/graphql`;
    });

    describe('unstarted engine', () => {
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

    describe('engine started', () => {
      // Start engine middleware (i.e. spawn proxy)
      beforeEach(async () => {
        await engine.start();
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
      it('processes batched queries', () => {
        return verifyEndpointBatch(url);
      });
      it('returns cache information', async () => {
        const body = await verifyEndpointSuccess(url, false);
        assert.notEqual(undefined, body['extensions'] && body['extensions']['cacheControl']);
      });
    });
  });

  describe('custom path routing', () => {
    it('allows routing root path through proxy', async () => {
      setupEngine('/');
      await engine.start();
      return verifyEndpointSuccess(`http://localhost:${engine.graphqlPort}/`, false);
    });

    it('does not route child path through proxy', async () => {
      setupEngine();

      // Request direct to server works:
      let childUrl = `http://localhost:${engine.graphqlPort}/graphql/ping`;
      let childDirect = await request.get(childUrl);
      assert.strictEqual('{"pong":true}', childDirect);

      // Start engine proxy:
      await engine.start();

      // Same request with middleware installed works:
      let childThroughProxy = await request.get(childUrl);
      assert.strictEqual('{"pong":true}', childThroughProxy);

      // GraphQL through proxy works too:
      return verifyEndpointSuccess(`http://localhost:${engine.graphqlPort}/graphql`, false);
    });
  });

  describe('child middleware', () => {
    let url;
    beforeEach(async () => {
      setupEngine('/graphql');
      await engine.start();
      url = `http://localhost:${engine.graphqlPort}/graphql`;
    });

    it('processes successful query', () => {
      return verifyEndpointSuccess(url, false);
    });

    it('processes successful GET query', () => {
      return verifyEndpointGet(url, false);
    });
  });
});
