const koa = require('koa');
const koaRouter = require('koa-router');
const koaBody = require('koa-bodyparser');
const {graphqlKoa} = require('apollo-server-koa');

const {Engine} = require('../lib/index');
const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError} = require('./schema');
const {startWithDelay, testEngine} = require('./test');

describe('koa middleware', () => {
  let app;

  function gqlServer() {
    let graphqlHandler = graphqlKoa({
      schema,
      rootValue,
      tracing: true
    });
    const router = new koaRouter();
    router.post('/graphql', koaBody(), graphqlHandler);
    router.get('/graphql', graphqlHandler);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app.listen(0);
  }

  beforeEach(() => {
    app = new koa();
  });

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
    let url;
    beforeEach(async () => {
      let engine = testEngine();
      app.use(engine.koaMiddleware());
      let server = gqlServer();
      engine.graphqlPort = server.address().port;
      await startWithDelay(engine);

      url = `http://localhost:${engine.graphqlPort}/graphql`;
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
