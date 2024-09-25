import { readFile, createReadStream } from 'fs'
import { createInterface } from 'readline'





export const renderTemplate = (path, template={}) => {
    return new Promise((res) => {
        const response = new Response()
        const lineInterface = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
        lineInterface.on('line', (line) => {
            let readLine = ''
            let key = undefined
            for (let i=0; i<line.length; i++) {
                readLine += line[i]
                if (i <= 2) continue

                const lastTwo = readLine.slice(-2)
                if (lastTwo === '{{') {
                    key = ''
                    continue
                }
                if (key === undefined) continue
                
                if (lastTwo === '}}') {
                    const value = template[key.slice(0, -1).trim()]
                    if (value !== undefined) readLine = readLine.slice(0, i-key.length-2) + value
                    key = undefined
                }
                else key += line[i]
            }
            response.body += readLine + '\r\n'
        })

        lineInterface.on('close', () => {
            if (response.body === '') {
                res(res(new Response(body, { 'Content-Type': 'text/html' }, 500, `no data in file '${path}'`)))
                return
            }
            response.headers = { 'Content-Type': 'text/html' }
            response.status = 200
            res(response)
        })
    })
}




export const sendFile = (path, mimeType) => {
    return new Promise((res) => {
        readFile(path, 'utf8', (err, data) => {
            if (err) res(new Response(data, { 'Content-Type': mimeType }, 500, err.message))
            else res(sendFileData(data, mimeType))
        })
    })
}





export const sendFileData = (data, mimeType) => {
    if (data === undefined) return new Response(data, { 'Content-Type': mimeType }, 500, `no data available`)
    if (mimeType === undefined) return new Response(data, { 'Content-Type': mimeType }, 500, `invalid mime type: '${mimeType}'`)
    return new Response(data, { 'Content-Type': mimeType }, 200)
}




export class Response {
    constructor(body='', headers={}, status=500, error=undefined) {
        this.body = body
        this.headers = headers
        this.status = status
        this.error = error
    }
}





class Request {
    constructor() {
        this.routes = {}
        this.lastRequest = {}
    }

    get baseUrl() { return this.lastRequest.baseUrl }

    get body() { return this.lastRequest.body }

    get headers() { return this.lastRequest.headers }

    get hostname() { return this.lastRequest.hostname }

    get ip() { return this.lastRequest.ip }

    get method() { return this.lastRequest.method }

    get originalUrl() { return this.lastRequest.originalUrl }

    get path() { return this.lastRequest.path }

    get query() { return this.lastRequest.query }

    onpath(path, callback, methods=[ 'GET' ]) {
        for (const method of methods) {
            this.routes[`${method}:${path.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/<[^>]+>/g, '([^/]+)')}`] = {
                callback: async (variables) => {
                    const response = await callback.apply(null, variables)
                    if (response === null || response === undefined) {
                        this.logError(`invalid response: ${response}`)
                        return { status: 500 }
                    }
                    if (response instanceof Response && response.error !== undefined) {
                        this.logError(response.error)
                        return { status: 500 }
                    }
                    if (Number.isInteger(response)) return { status: response }
                    if (typeof response === 'string' || typeof response === 'number') return { body: response.toString(), status: 200 }
                    if (Array.isArray(response)) return { body: JSON.stringify(response), headers: { 'Content-Type': 'application/json' }, status: 200 }
                    if (response instanceof Response) return { body: response.body, headers: response.headers, status: response.status }
                    if (typeof response === 'object') return { body: JSON.stringify(response), headers: { 'Content-Type': 'application/json' },status: 200 }
                    this.logError(`invalid response: ${response}`)
                    return { status: 500 }
                },
                pathElements: path.split('/')
            }
            
        }
    }

    async handleRequest(request) {
        this.time = Date.now()
        this.lastRequest = request
        let response = { status: 404 }
        for (const [ route, { callback, pathElements } ] of Object.entries(this.routes)) {
            const [ method, path ] = route.split(':')
            const regex = new RegExp(`^${path}$`)
            if (!regex.test(request.path) || method !== request.method) continue
            const elements = request.path.split('/')
            if (elements.length !== pathElements.length) break
            const variables = []
            for (let i=0; i<elements.length; i++) {
                if (pathElements[i].startsWith('<') && pathElements[i].endsWith('>')) variables.push(elements[i])
            }
            response = await callback(variables)
            return response
        }
        return response
    }

    logError(error) {
        if (typeof this.onerror === 'function') this.onerror(error)
    }
}





export const easyHttpRequestHandler = (hadlerConfigFunction) => {
    const handler = new Request()
    hadlerConfigFunction(handler)

    return async (request) => {
        try {
            const response = await handler.handleRequest(request)
            if (typeof handler.onresponse === 'function') handler.onresponse(response)
            return response
        }
        catch(error) {
            handler.logError(error.message)
        }
    }
}