import {ChildProcess, spawn} from 'child_process';
import {randomBytes} from 'crypto';
import {readFileSync} from 'fs';
import {EventEmitter} from 'events';
import {parse as urlParser} from 'url';

// Typings are not available
const StreamJsonObjects = require('stream-json/utils/StreamJsonObjects');

import {
    MiddlewareParams,
    makeMicroMiddleware,
    makeExpressMiddleware,
    makeConnectMiddleware,
    makeKoaMiddleware,
    instrumentHapi
} from './middleware';

export type LogLevels = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AccessLogConfig {
    destination: string,
    requestHeaders?: string[],
    responseHeaders?: string[],
}

export interface ExtensionsConfig {
    strip?: string[],
    blacklist?: string[],
}

// User-configurable fields of EngineConfig "frontend"
export interface FrontendParams {
    extensions?: ExtensionsConfig,
}

// All configuration of "frontend" (including fields managed by apollo-engine-js)
export interface FrontendConfig extends FrontendParams {
    host: string,
    endpoint: string,
    port: number,
}

// User-configurable fields of EngineConfig "origin"
export interface OriginParams {
    requestTimeout?: string,
    maxConcurrentRequests?: number,
    supportsBatch?: boolean,
    http?: OriginHttpParams,
}

export interface OriginHttpParams {
    trustedCertificates?: string,
    disableCertificateCheck?: boolean,
    overrideRequestHeaders?: {
        [headerName: string]: string
    }
}

export interface OriginHttpConfig extends OriginHttpParams {
    url: string,
    headerSecret: string,
}

// All configuration of "origin"  (including fields managed by apollo-engine-js)
export interface OriginConfig extends OriginParams {
    http?: OriginHttpConfig
}

export interface EngineConfig {
    apiKey: string,
    origins?: OriginConfig[],
    frontends?: FrontendConfig[],
    stores?: {
        name: string,
        memcache?: {
            url: string[],
            timeout?: string,
            keyPrefix?: string,
        },
        inMemory?: {
            cacheSize?: number
        },
    }[],
    sessionAuth?: {
        header?: string,
        cookie?: string,
        tokenAuthUrl?: string
        store?: string,
    },
    logging?: {
        level?: LogLevels,
        request?: AccessLogConfig,
        query?: AccessLogConfig,
        format?: string,
        destination?: string,
    },
    reporting?: {
        endpointUrl?: string,
        maxAttempts?: number,
        retryMinimum?: string,
        retryMaximum?: string,
        debugReports?: boolean,
        noTraceVariables?: boolean,
        privateHeaders?: string[],
        privateVariables?: string[],
        disabled?: boolean,
        proxyUrl?: string,
    },
    queryCache?: {
        publicFullQueryStore?: string,
        privateFullQueryStore?: string,
    },
    persistedQueries?: {
        store?: string,
        compressionThreshold?: number,
    }
}

export interface SideloadConfig {
    engineConfig: string | EngineConfig,
    endpoint?: string,
    graphqlPort?: number,
    // Should all requests/responses to the proxy be written to stdout?
    dumpTraffic?: boolean,
    // Milliseconds to wait for the proxy binary to start; set to <=0 to wait forever.
    // If not set, defaults to 5000ms.
    startupTimeout?: number,
    origin?: OriginParams
    frontend?: FrontendParams
}

export class Engine extends EventEmitter {
    private child: ChildProcess | null;
    private graphqlPort: number;
    private binary: string;
    private config: string | EngineConfig;
    private middlewareParams: MiddlewareParams;
    private running: Boolean;
    private startupTimeout: number;
    private originParams: OriginParams;
    private frontendParams: FrontendParams;

    public constructor(config: SideloadConfig) {
        super();
        this.running = false;
        if (typeof config.startupTimeout === 'undefined') {
            this.startupTimeout = 5000;
        } else {
            this.startupTimeout = config.startupTimeout;
        }
        this.middlewareParams = new MiddlewareParams();
        this.middlewareParams.endpoint = config.endpoint || '/graphql';
        this.middlewareParams.psk = randomBytes(48).toString("hex");
        this.middlewareParams.dumpTraffic = config.dumpTraffic || false;
        this.originParams = config.origin || {};
        this.frontendParams = config.frontend || {};
        if (config.graphqlPort) {
            this.graphqlPort = config.graphqlPort;
        } else {
            const port: any = process.env.PORT;
            if (isFinite(port)) {
                this.graphqlPort = parseInt(port, 10);
            } else {
                throw new Error(`Neither 'graphqlPort' nor process.env.PORT is set. ` +
                    `In order for Apollo Engine to act as a proxy for your GraphQL server, ` +
                    `it needs to know which port your GraphQL server is listening on (this is ` +
                    `the port number that comes before '/graphql'). If you see this error, you ` +
                    `should make sure to add e.g. 'graphqlPort: 1234' wherever you call new Engine(...).`);
            }
        }
        this.config = config.engineConfig;
        switch (process.platform) {
            case 'darwin': {
                this.binary = require.resolve('apollo-engine-binary-darwin/engineproxy_darwin_amd64');
                break;
            }
            case 'linux': {
                this.binary = require.resolve('apollo-engine-binary-linux/engineproxy_linux_amd64');
                break;
            }
            case 'win32': {
                this.binary = require.resolve('apollo-engine-binary-windows/engineproxy_windows_amd64.exe');
                break;
            }
            default: {
                throw new Error('Unsupported platform');
            }
        }
    }

    public start(): Promise<number> {
        if (this.running) {
            throw new Error('Only call start() on an engine object once');
        }
        this.running = true;
        let config = this.config;
        const endpoint = this.middlewareParams.endpoint;
        const graphqlPort = this.graphqlPort;

        if (typeof config === 'string') {
            config = JSON.parse(readFileSync(config as string, 'utf8') as string);
        }

        // Customize configuration:
        const childConfig = Object.assign({}, config as EngineConfig);

        // Logging format _must_ be JSON to stdout
        if (!childConfig.logging) {
            childConfig.logging = {}
        } else {
            if (childConfig.logging.format && childConfig.logging.format !== 'JSON') {
                console.error(`Invalid logging format: ${childConfig.logging.format}, overridden to JSON.`);
            }
            if (childConfig.logging.destination && childConfig.logging.destination !== 'STDOUT') {
                console.error(`Invalid logging destination: ${childConfig.logging.format}, overridden to STDOUT.`);
            }
        }
        childConfig.logging.format = 'JSON';
        childConfig.logging.destination = 'STDOUT';

        // Inject frontend, that we will route
        const frontend = Object.assign({
            host: '127.0.0.1',
            endpoint,
            port: 0,
        }, this.frontendParams);
        if (typeof childConfig.frontends === 'undefined') {
            childConfig.frontends = [frontend];
        } else {
            childConfig.frontends.push(frontend);
        }

        if (typeof childConfig.origins === 'undefined') {
            const origin = Object.assign({}, this.originParams) as OriginConfig;
            if (typeof origin.http === 'undefined') {
                origin.http = {
                    url: 'http://127.0.0.1:' + graphqlPort + endpoint,
                    headerSecret: this.middlewareParams.psk
                };
            } else {
                Object.assign(origin.http, {
                    url: 'http://127.0.0.1:' + graphqlPort + endpoint,
                    headerSecret: this.middlewareParams.psk
                });
            }
            childConfig.origins = [origin];
        } else {
            // Extend any existing HTTP origins with the chosen PSK:
            // (trust it to fill other fields correctly)
            childConfig.origins.forEach(origin => {
                if (typeof origin.http === 'object') {
                    Object.assign(origin.http, {
                        headerSecret: this.middlewareParams.psk,
                    });
                }
            });
        }

        const spawnChild = () => {
            // If logging >INFO, still log at info, then filter in node:
            // This is because startup notifications are at INFO level.
            let logLevelFilter: any;
            const logLevel = childConfig.logging!.level;
            if (logLevel) {
                if (logLevel.match(/^warn(ing)?$/i)) {
                    childConfig.logging!.level = 'info';
                    logLevelFilter = /^(warn(ing)?|error|fatal)$/;
                } else if (logLevel.match(/^error$/i)) {
                    childConfig.logging!.level = 'info';
                    logLevelFilter = /^(error|fatal)$/;
                } else if (logLevel.match(/^fatal$/i)) {
                    childConfig.logging!.level = 'info';
                    logLevelFilter = /^fatal$/;
                }
            }
            let childConfigJson = JSON.stringify(childConfig) + '\n';

            const child = spawn(this.binary, ['-config=stdin']);
            this.child = child;

            const logStream = StreamJsonObjects.make();
            logStream.output.on('data', (logData: any) => {
                const logRecord = logData.value;

                // Look for message indicating successful startup:
                if (logRecord.msg === 'Started HTTP server.') {
                    const address = logRecord.address;
                    this.middlewareParams.uri = `http://${address}`;

                    // Notify proxy has started:
                    this.emit('start');

                    // If we hacked the log level, revert:
                    if (logLevelFilter) {
                        childConfig.logging!.level = logLevel;
                        childConfigJson = JSON.stringify(childConfig) + '\n';
                        child.stdin.write(childConfigJson);

                        // Remove the filter after the child has had plenty of time to reload the config:
                        setTimeout(() => {
                            logLevelFilter = null;
                        }, 1000);
                    }
                }

                // Print log message:
                if (!logLevelFilter || !logRecord.level || logRecord.level.match(logLevelFilter)) {
                    console.log({proxy: logRecord});
                }
            });

            logStream.input.on('error', () => {
                // We received non-json output, dump it to stderr:
                console.error(logStream.input._buffer);
            });
            // Connect log hooks:
            child.stdout.pipe(logStream.input);
            child.stderr.pipe(process.stderr);

            // Feed config into process:
            child.stdin.write(childConfigJson);

            // Connect shutdown hooks:
            child.on('exit', (code, signal) => {
                // Wipe the URI, so middleware doesn't route to dead process:
                this.middlewareParams.uri = '';

                if (!this.running) {
                    // It's not an error if we think it's our fault.
                    return;
                }
                if (code === 78) {
                    this.emit('error', new Error('Engine crashed due to invalid configuration.'));
                    return;
                }

                if (code != null) {
                    console.error(`Engine crashed unexpectedly with code: ${code}`);
                }
                if (signal != null) {
                    console.error(`Engine was killed unexpectedly by signal: ${signal}`);
                }
                spawnChild();
            });
        };

        spawnChild();

        return new Promise((resolve, reject) => {
            let cancelTimeout: NodeJS.Timer;
            if (this.startupTimeout > 0) {
                cancelTimeout = setTimeout(() => {
                    this.running = false;
                    if (this.child) {
                        this.child.kill('SIGKILL');
                        this.child = null;
                    }
                    return reject(Error('timed out'));
                }, this.startupTimeout);
            }

            this.on('start', () => {
                clearTimeout(cancelTimeout);
                const port = urlParser(this.middlewareParams.uri).port;
                if (!port) {
                    return reject('unknown url');
                }
                resolve(parseInt(port, 10));
            });
        });
    }

    public microMiddleware(): (fn: Function) => void {
        return makeMicroMiddleware(this.middlewareParams);
    }

    public expressMiddleware(): (req: any, res: any, next: any) => void {
        return makeExpressMiddleware(this.middlewareParams);
    }

    public connectMiddleware(): (req: any, res: any, next: any) => void {
        return makeConnectMiddleware(this.middlewareParams);
    }

    public koaMiddleware(): (ctx: any, next: any) => void {
        return makeKoaMiddleware(this.middlewareParams);
    }

    public instrumentHapiServer(server: any) {
        instrumentHapi(server, this.middlewareParams);
    }

    public stop(): Promise<void> {
        if (this.child === null) {
            throw new Error('No engine instance running...');
        }
        const childRef = this.child;
        this.child = null;
        this.running = false;
        return new Promise((resolve) => {
            childRef.on('exit', () => {
                resolve();
            });
            childRef.kill();
        });
    }
}
