import {ChildProcess, execFile} from 'child_process';
import {randomBytes} from 'crypto';
import {createServer} from 'net';
import {resolve} from 'path';
import {readFileSync, existsSync} from 'fs';

import {
    MiddlewareParams,
    makeExpressMiddleware,
    makeConnectMiddleware,
    makeKoaMiddleware,
    instrumentHapi
} from './middleware';

const LineWrapper = require('stream-line-wrapper');

export type LogLevels = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface EngineConfig {
    apiKey: string,
    reporting?: {
        endpointUrl?: string,
        maxAttempts?: number,
        retryMinimum?: string,
        retryMaximum?: string,
        debugReports?: boolean
    },
    logcfg?: {
        level: LogLevels
    },
    stores?: [
        {
            name: string,
            epoch?: number,
            timeout?: string,
            memcaches: [
                {
                    url: string
                }
            ]
        }
        ],
    operations?: [
        {
            signature: string,
            perSession?: boolean,
            caches: [
                {
                    ttl: number,
                    store: string
                }
            ]
        }
        ],
    origins?: [
        {
            url: string,
            requestTimeout?: string,
            headerSecret: string,
        }
        ],
    frontends?: [
        {
            host: string,
            endpoint: string,
            port: number,
        }
        ],
    sessionAuth?: {
        header: string,
        store?: string,
        tokenAuthUrl?: string
    }
}

export interface SideloadConfig {
    engineConfig: string | EngineConfig,
    endpoint?: string,
    graphqlPort?: number,
    dumpTraffic?: boolean
}

export class Engine {
    private child: ChildProcess | null;
    private graphqlPort: number;
    private binary: string;
    private config: string | EngineConfig;
    private middlewareParams: MiddlewareParams;

    public constructor(config: SideloadConfig) {
        this.middlewareParams = new MiddlewareParams();
        this.middlewareParams.endpoint = config.endpoint || '/graphql';
        this.middlewareParams.psk = randomBytes(48).toString("hex");
        this.middlewareParams.dumpTraffic = config.dumpTraffic || false;
        if (config.graphqlPort) {
            this.graphqlPort = config.graphqlPort;
        } else {
            const port = process.env.PORT;
            if (port) {
                this.graphqlPort = parseInt(port, 10);
            } else {
                throw new Error('process.env.PORT is not set!');
            }
        }
        this.config = config.engineConfig;
        switch (process.platform) {
            case 'darwin': {
                this.binary = 'apollo-engine-binary-darwin/engineproxy_darwin_amd64';
                break;
            }
            case 'linux': {
                this.binary = 'apollo-engine-binary-linux/engineproxy_linux_amd64';
                break;
            }
            case 'win32': {
                this.binary = 'apollo-engine-binary-windows/engineproxy_windows_amd64.exe';
                break;
            }
            default: {
                throw new Error('Unsupported platform');
            }
        }
    }

    public start(): Promise<number> {
        let config = this.config;
        const endpoint = this.middlewareParams.endpoint;
        const graphqlPort = this.graphqlPort;

        if (typeof config === 'string') {
            config = JSON.parse(readFileSync(config as string, 'utf8') as string);
        }

        // Allocate a random port for the proxy:
        const srv = createServer();
        return new Promise(resultPort => {
            srv.on('listening', () => {
                const port = srv.address().port;
                srv.close();
                this.middlewareParams.uri = 'http://127.0.0.1:' + port;

                // Customize configuration:
                const childConfig = Object.assign({}, config as EngineConfig);

                // Inject frontend, that we will route
                let frontend = {
                    host: '127.0.0.1',
                    endpoint,
                    port
                };
                if (typeof childConfig.frontends === 'undefined') {
                    childConfig.frontends = [frontend];
                } else {
                    childConfig.frontends.push(frontend);
                }

                let origin = {
                    url: 'http://127.0.0.1:' + graphqlPort + endpoint,
                    headerSecret: this.middlewareParams.psk
                };
                if (typeof childConfig.origins === 'undefined') {
                    childConfig.origins = [origin];
                } else {
                    childConfig.origins.push(origin)
                }

                let binaryPath = resolve(__dirname, '../node_modules', this.binary);
                if (!existsSync(binaryPath)) {
                    binaryPath = resolve(__dirname, '../../../node_modules', this.binary);
                }

                const env = {'env': Object.assign({'ENGINE_CONFIG': JSON.stringify(childConfig)}, process.env)};
                let child = execFile(binaryPath, ['-config=env', '-restart=true'], env);
                child.stdout.pipe(this.engineLineWrapper()).pipe(process.stdout);
                child.stderr.pipe(this.engineLineWrapper()).pipe(process.stderr);
                child.on('exit', () => {
                    if (child != null) {
                        throw new Error('Engine crashed unexpectedly')
                    }
                });
                resultPort(port);
            }).listen(0);
        });
    }

    private engineLineWrapper(): any {
        return new LineWrapper({prefix: 'EngineProxy ==> '});
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

    public stop() {
        if (this.child == null) {
            throw new Error('No engine instance running...');
        }
        const childRef = this.child;
        this.child = null;
        childRef.kill();
    }
}
