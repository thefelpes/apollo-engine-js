const {buildSchema} = require('graphql');
const request = require('request');
const {assert} = require('chai');

exports.schema = buildSchema(`
  type Query {
    hello: String @cacheControl(maxAge: 30)
    errorTrigger: String
  }
`);

exports.rootValue = {
  hello: () => {
    return 'Hello World';
  },
  errorTrigger: () => {
    throw new Error('Kaboom');
  }
};


exports.verifyEndpointSuccess = (url, hasTracing) => {
  return new Promise((resolve) => {
    request.post({
      url,
      json: true,
      body: {'query': '{ hello }'}
    }, (err, response, body) => {
      assert.strictEqual('Hello World', body['data']['hello']);
      if (hasTracing) {
        assert.notEqual(undefined, body['extensions'] && body['extensions']['tracing']);
      } else {
        assert.strictEqual(undefined, body['extensions'] && body['extensions']['tracing']);
      }
      resolve(body);
    });
  })
};

exports.verifyEndpointBatch = (url, hasTracing) => {
  return new Promise((resolve) => {
    request.post({
      url,
      json: true,
      body: [{'query': '{ hello }'}, {'query': '{ hello }'}]
    }, (err, response, body) => {
      assert.strictEqual(2, body.length);

      body.forEach(body => {
        assert.strictEqual('Hello World', body['data']['hello']);
        if (hasTracing) {
          assert.notEqual(undefined, body['extensions'] && body['extensions']['tracing']);
        } else {
          assert.strictEqual(undefined, body['extensions'] && body['extensions']['tracing']);
        }
      });

      resolve();
    });
  })
};

exports.verifyEndpointFailure = (url) => {
  return new Promise((resolve) => {
    request.post({
      url,
      json: true,
      body: {'query': '{ validButDoesNotComplyToSchema }'}
    }, (err, response, body) => {
      if (response.statusCode === 200) {
        // Proxy responds with an error-ed 200:
        assert.strictEqual('Cannot query field "validButDoesNotComplyToSchema" on type "Query".',
          response.body['errors'][0]['message'])
      } else {
        // Express responds with a 400
        assert.strictEqual(400, response.statusCode);
      }
      resolve();
    });
  });
};

exports.verifyEndpointError = (url) => {
  return new Promise((resolve) => {
    request.post({
      url,
      json: true,
      body: {'query': '{ errorTrigger }'}
    }, (err, response, body) => {
      assert.strictEqual(200, response.statusCode);
      assert.strictEqual('Kaboom', body['errors'][0]['message']);
      resolve();
    });
  });
};

exports.verifyEndpointGet = (url, hasTracing) => {
  return new Promise((resolve) => {
    let query = '{ hello }';
    request.get({
      url: `${url}?query=${encodeURIComponent(query)}`,
      json: true,
    }, (err, response, body) => {
      assert.strictEqual(200, response.statusCode);
      assert.strictEqual('Hello World', body['data']['hello']);
      if (hasTracing) {
        assert.notEqual(undefined, body['extensions'] && body['extensions']['tracing']);
      } else {
        assert.strictEqual(undefined, body['extensions'] && body['extensions']['tracing']);
      }
      resolve();
    });
  });
};
