const connect = require('connect');
const bodyParser = require('body-parser');
const {graphqlConnect} = require('apollo-server-express');
const http = require('http');

const {Engine} = require('../lib/index');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError} = require('./schema');
const {startWithDelay, testEngine} = require('./test');

describe('connect middleware', () => {
  let app;
  beforeEach(() => {
    app = new connect();
  });

  function gqlServer() {
    app.use('/graphql', bodyParser.json());
    app.use('/graphql', graphqlConnect({
      schema,
      rootValue,
      tracing: true
    }));
    return http.createServer(app).listen(0);
  }

  describe('without engine', () => {
    let url;
    beforeEach(() => {
      let server = gqlServer();
      url = `http://localhost:${server.address().port}/graphql`;
    });

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

  describe('with engine', () => {
    let url, engine;
    beforeEach(async () => {
      engine = testEngine();
      app.use(engine.connectMiddleware());
      let server = gqlServer();
      engine.graphqlPort = server.address().port;
      await startWithDelay(engine);
      url = `http://localhost:${engine.graphqlPort}/graphql`;
    });

    afterEach(() => {
      engine.stop();
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
