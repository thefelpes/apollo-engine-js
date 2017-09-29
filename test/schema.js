const {buildSchema} = require('graphql');
const request = require('request');
const {assert} = require('chai');

exports.schema = buildSchema(`
  type Query {
    hello: String
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


exports.verifyEndpointSuccess = function (url, tracing, done) {
  request.post({
    url,
    json: true,
    body: {'query': '{ hello }'}
  }, function (err, response, body) {
    assert.strictEqual('Hello World', body['data']['hello']);
    if (tracing) {
      assert.notEqual(undefined, body['extensions'] && body['extensions']['tracing']);
    } else {
      assert.strictEqual(undefined, body['extensions'] && body['extensions']['tracing']);
    }
    done();
  });
};

exports.verifyEndpointFailure = function (url, done) {
  request.post({
    url,
    json: true,
    body: {'query': '{ validButDoesNotComplyToSchema }'}
  }, function (err, response, body) {
    if (response.statusCode === 200) {
      // Proxy responds with an error-ed 200:
      assert.strictEqual('Cannot query field "validButDoesNotComplyToSchema" on type "Query".',
        response.body['errors'][0]['message'])
    } else {
      // Express responds with a 400
      assert.strictEqual(400, response.statusCode);
    }
    done();
  });
};

exports.verifyEndpointError = function (url, done) {
  request.post({
    url,
    json: true,
    body: {'query': '{ errorTrigger }'}
  }, function (err, response, body) {
    assert.strictEqual(200, response.statusCode);
    assert.strictEqual('Kaboom', body['errors'][0]['message']);
    done();
  });
};
