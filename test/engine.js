const http = require('http');
const express = require('express');
const {graphqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');
const {createServer} = require('net');

const {assert} = require('chai');
const isRunning = require('is-running');

const {Engine} = require('../lib/index');

const {schema, rootValue, verifyEndpointSuccess} = require('./schema');
const {testEngine} = require('./test');

describe('engine', () => {
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
      schema: schema,
      rootValue: rootValue,
      tracing: true
    }));

    return http.createServer(app).listen().address().port;
  }

  function setupEngine(path) {
    engine = testEngine(path);
    app.use(engine.expressMiddleware());

    engine.graphqlPort = gqlServer(path);
  }

  describe('config', () => {
    it('allows reading from file proxy', async () => {
      // Install middleware before GraphQL handler:
      engine = new Engine({
        endpoint: '/graphql',
        engineConfig: 'test/engine.json',
        graphqlPort: 1
      });
      app.use(engine.expressMiddleware());

      let port = gqlServer('/graphql');
      engine.graphqlPort = port;

      await engine.start();
      return verifyEndpointSuccess(`http://localhost:${port}/graphql`, false);
    });

    it('appends configuration', (done) => {
      // Grab a random port locally:
      const srv = createServer();
      srv.on('listening', async () => {
        const extraPort = srv.address().port;
        srv.close();

        // Setup engine, with an extra frontend on that port:
        let engineConfig = {
          apiKey: 'faked',
          frontends: [{
            host: '127.0.0.1',
            endpoint: '/graphql',
            port: extraPort
          }],
          reporting: {
            noTraceVariables: true
          }
        };
        engine = new Engine({
          endpoint: '/graphql',
          engineConfig,
          graphqlPort: 1
        });
        app.use(engine.expressMiddleware());

        let port = gqlServer('/graphql');
        // Provide origins _before_ starting:
        engineConfig.origins = [
          {
            name: 'lambda',
            lambda: {
              functionArn: 'arn:aws:lambda:us-east-1:1234567890:function:mock_function',
              awsAccessKeyId: 'foo',
              awsSecretAccessKey: 'bar'
            }
          },
          {
            http: {
              url: `http://localhost:${port}/graphql`
            }
          }
        ];
        await engine.start();

        // Non-HTTP origin unchanged:
        assert.strictEqual(undefined, engineConfig.origins[0].http);
        // HTTP origin has PSK injected:
        assert.notEqual(undefined, engineConfig.origins[1].http.headerSecret);

        await verifyEndpointSuccess(`http://localhost:${port}/graphql`, false);
        await verifyEndpointSuccess(`http://localhost:${extraPort}/graphql`, false);
        done();
      }).listen(0)
    });

    it('sets default startup timeout', () => {
      engine = new Engine({
        graphqlPort: 1,
      });
      assert.strictEqual(engine.startupTimeout, 5000);
    });

    it('accepts zero startup timeout', () => {
      engine = new Engine({
        graphqlPort: 1,
        startupTimeout: 0,
      });
      assert.strictEqual(engine.startupTimeout, 0);
    })
  });

  describe('process', () => {
    it('restarts binary', async () => {
      setupEngine();
      await engine.start();

      const url = `http://localhost:${engine.graphqlPort}/graphql`;
      await verifyEndpointSuccess(url);

      const childPid = engine.child.pid;
      const childUri = engine.middlewareParams.uri;
      assert.isTrue(isRunning(childPid));

      // Directly kill process, wait for notice another process has started:
      const restartPromise = new Promise(resolve => {
        engine.once('start', resolve);
      });
      engine.child.kill('SIGKILL');
      await restartPromise;

      const restartedPid = engine.child.pid;
      assert.notEqual(childPid, restartedPid);
      assert.isFalse(isRunning(childPid));
      assert.isTrue(isRunning(restartedPid));

      assert.notEqual(childUri, engine.middlewareParams.uri);
    });

    it('is non-invasive on invalid config', async () => {
      setupEngine();
      engine.startupTimeout = 100;
      engine.config.logging.level = 'invalid';

      engine.on('error', (err) => {
        assert.match(err, /Engine crashed due to invalid configuration/);
      });
      try {
        await engine.start();
        assert.fail('Error not thrown');
      } catch (err) {
        assert.match(err, /timed out/);
      }
      assert.strictEqual('', engine.middlewareParams.uri);
    });
  })
});
