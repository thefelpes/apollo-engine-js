const micro = require('micro');
const {microGraphql} = require('apollo-server-micro');
const {get, post, router} = require('microrouter')

const {schema, rootValue, verifyEndpointSuccess, verifyEndpointFailure, verifyEndpointError, verifyEndpointGet} = require('./schema');
const {testEngine} = require('./test');

describe('micro middleware', () => {
  let app;

  function applyMiddlewares(...middlewares) {
    return middlewares.reduce((f, g) => (...args) => f(g(...args)));
  }

  function gqlServer(middleware) {
    const handler = microGraphql({
      schema,
      rootValue,
      tracing: true
    });

    app = micro(
      applyMiddlewares(middleware)(
        router(
          get('/graphql', handler),
          post('/graphql', handler)
        )
      )
    );

    return app.listen(0);
  }

  describe('without engine', () => {
    let url;
    beforeEach(() => {
      let server = gqlServer(fn => fn);
      url = `http://localhost:${server.address().port}/graphql`;
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
      engine = testEngine();
      let server = gqlServer(engine.microMiddleware());
      url = `http://localhost:${server.address().port}/graphql`;
      engine.graphqlPort = server.address().port;
      await engine.start();
      url = `http://localhost:${engine.graphqlPort}/graphql`;
    });
  
    afterEach(() => {
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
  });
});
