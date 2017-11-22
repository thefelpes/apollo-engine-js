import {Request, Response, NextFunction} from 'express'
import {Context} from 'koa'
import {Server} from 'hapi'
import * as request from 'request'
import {IncomingMessage, ServerResponse} from 'http';
import { parse as urlParser } from 'url';

export class MiddlewareParams {
    public endpoint: string;
    public uri: string;
    public psk: string;
    public dumpTraffic: boolean;
}

export function makeMicroMiddleware(params: MiddlewareParams) {
    return function(fn: Function) {
        return function (req: IncomingMessage, res: ServerResponse) {
            const { pathname } = urlParser(req.url || '');
            if (!params.uri || pathname !== params.endpoint) return fn(req, res);
            else if (req.method !== 'GET' && req.method !== 'POST') return fn(req, res);
            else if (req.headers['x-engine-from'] === params.psk) return fn(req, res);
            else proxyRequest(params, req, res);
        }
    }
}

export function makeExpressMiddleware(params: MiddlewareParams) {
    const endpointRegex = new RegExp(`^${params.endpoint}(\\?|$)`);
    return function (req: Request, res: Response, next: NextFunction) {
        if (!params.uri || !endpointRegex.test(req.originalUrl)) next();
        else if (req.method !== 'GET' && req.method !== 'POST') next();
        else if (req.headers['x-engine-from'] === params.psk) next();
        else {
            req.url = req.originalUrl;
            proxyRequest(params, req, res);
        }
    }
}

export function makeConnectMiddleware(params: MiddlewareParams) {
    const endpointRegex = new RegExp(`^${params.endpoint}(\\?|$)`);
    return function (req: any, res: any, next: any) {
        if (!params.uri || !endpointRegex.test(req.originalUrl)) next();
        else if (req.method !== 'GET' && req.method !== 'POST') next();
        else if (req.headers['x-engine-from'] === params.psk) next();
        else {
            req.url = req.originalUrl;
            proxyRequest(params, req, res);
        }
    }
}

export function makeKoaMiddleware(params: MiddlewareParams) {
    return function (ctx: Context, next: () => Promise<any>) {
        if (!params.uri || ctx.path !== params.endpoint) return next();
        else if (ctx.req.headers['x-engine-from'] === params.psk) return next();
        else if (ctx.req.method !== 'GET' && ctx.req.method !== 'POST') return next();
        else return new Promise((resolve) => {
                ctx.req.pipe(request(params.uri + ctx.originalUrl, (error, response, body) => {
                    if (response.statusCode) ctx.response.status = response.statusCode;
                    ctx.response.set(JSON.parse(JSON.stringify(response.headers)));
                    ctx.response.body = body;
                    resolve();
                }));
            });
    }
}


export function instrumentHapi(server: Server, params: MiddlewareParams) {
    server.ext('onRequest', (req, reply) => {
        if (!params.uri) return reply.continue();
        const path = req.url.pathname;
        if (!path || path !== params.endpoint) return reply.continue();
        else if (req.method !== 'get' && req.method !== 'post') return reply.continue();
        else if (req.headers['x-engine-from'] === params.psk) return reply.continue();
        else proxyRequest(params, req.raw.req, req.raw.res);
    });
}

function proxyRequest(params: MiddlewareParams, req: IncomingMessage, res: ServerResponse) {
    if (params.dumpTraffic) {
        req.pipe(process.stdout);
    }

    const proxyRes = req.pipe(request({
        uri: params.uri + req.url,
        forever: true,
    }))
        .on('error', (err) => {
            console.error(err);
            res.writeHead(503);
            res.end();
        });

    if (params.dumpTraffic) {
        proxyRes.pipe(process.stdout);
    }
    proxyRes.pipe(res);
}
