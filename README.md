# Apollo Engine
This package integrates the Apollo Engine proxy with your GraphQL server.

When installed, it starts the Apollo Engine proxy in a new process, then routes
GraphQL requests through that proxy:

![Sequence Diagram](docs/sequence-diagram.png)

# Usage
```js
import { Engine } from 'apollo-engine';

// create new engine instance from JS config object
const engine = new Engine({ engineConfig: { ... } });

// create new engine instance from file
const engine = new Engine({ engineConfig: 'path/to/config.json' });

await engine.start();
app.use(engine.expressMiddleware());

// ...
// other middleware / handlers
// ...
```

To shut down engine
```js
engine.stop();
```

The graphql server should have tracing enabled if available. If you are using Apollo Server (v1.1.0 or newer), enable the tracing: true configuration option.

# Full Proxy Configuration
In addition to `engineConfig`, the configuration object can have the following fields:
- `endpoint`: Your graphql endpoint ('/graphql' by default)
- `graphqlPort`: The port that your graphql server is running on (`process.env.PORT` by default)

# Minimum Engine Configuration
This is the minimum necessary information in the engine configuration object to enable sending tracing and telemetry information.

```json
{
  "apiKey": "service:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

# Full Engine Configuration
The following is an exhaustive configuration showing all the available keys and their default values
```json
{
  "apiKey": "service:mdg-private-starwars-caching-test:l9VBHi_4k8WXpr5-IGJERA",
  "logcfg": {
    "level": "DEBUG"
  },
  "reporting": {
    "endpointUrl": "https://optics-staging-report.apollodata.com"
  },
  "stores": [
    {
      "name": "standardCache",
      "salt": "V0FagaqZIl",
      "epoch": 2,
      "timeout": "1s",
      "memcaches": [
        {
          "url": "localhost:11211"
        }
      ]
    },
    {
      "name": "embeddedCache",
      "salt": "hDe87famf",
      "epoch": 0,
      "cacheSize": 1048576
    }
  ],
  "operations": [
    {
      "signature": "query hero{hero{name}}",
      "caches": [
        {
          "perSession": false,
          "ttl": 600,
          "store": "standardCache"
        }
      ]
    },
    {
      "signature": "{hero{name}}",
      "caches": [
        {
          "perSession": false,
          "ttl": 5,
          "store": "embeddedCache"
        }
      ]
    }
  ],
  "sessionAuth": {
    "store": "standardCache",
    "header": "X-AUTH-TOKEN",
    "tokenAuthUrl": "http://session-server.com/auth-path"
  },
  "rateLimiting": {
    "maxCredits": 2000,
    "defaultCost": 1,
    "types": [
      {
        "name": "Droid",
        "cost": 500
      }
    ],
    "bucketInterval": "1s",
    "numBuckets": 5,
    "store": "standardCache"
  }
}
```

# Configuring auth sessions
In order to ascertain a user's eligibility to access their session cache, an endpoint on the origin server needs to be able to respond to that effect. 

- `config.sessionAuth`
  - `.header` describes the header that should contain the session token
  - `.tokenAuthUrl` describes the endpoint name on the origin server which should receive the token in the POST body and respond with:
    - `200 OK` and JSON body `{ "ttl": 3000 }` when the token is valid
    - `403 Forbidden` and if not
