import {Request, Response, NextFunction} from 'express'
import {Context} from 'koa'
import {Server} from 'hapi'
import * as request from 'request'
import {IncomingMessage, ServerResponse} from "http";

export class MiddlewareParams {
    public endpoint: string;
    public uri: string;
    public psk: string;
    public dumpTraffic: boolean;
}

export function makeExpressMiddleware(params: MiddlewareParams) {
    return function (req: Request, res: Response, next: NextFunction) {
        if (!params.uri || req.path !== params.endpoint) next();
        else if (req.method !== 'GET' && req.method !== 'POST') next();
        else if (req.headers['x-engine-from'] === params.psk) next();
        else proxyRequest(params, req, res);
    }
}

export function makeConnectMiddleware(params: MiddlewareParams) {
    return function (req: any, res: any, next: any) {
        if (!params.uri || req.originalUrl !== params.endpoint) next();
        else if (req.method !== 'GET' && req.method !== 'POST') next();
        else if (req.headers['x-engine-from'] === params.psk) next();
        else proxyRequest(params, req, res);
    }
}

export function makeKoaMiddleware(params: MiddlewareParams) {
    return function (ctx: Context, next: () => Promise<any>) {
        if (!params.uri || ctx.path !== params.endpoint) return next();
        else if (ctx.req.headers['x-engine-from'] === params.psk) return next();
        else if (ctx.req.method !== 'GET' && ctx.req.method !== 'POST') return next();
        else return new Promise((resolve) => {
                ctx.req.pipe(request(params.uri + params.endpoint, (error, response, body) => {
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
        const path = req.url.path;
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

    let proxyRes = req.pipe(request(params.uri + params.endpoint));
    if (params.dumpTraffic) {
        proxyRes.pipe(process.stdout);
    }
    proxyRes.pipe(res);
}
