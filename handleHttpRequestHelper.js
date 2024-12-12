import { readFile, createReadStream } from 'fs'
import { createInterface } from 'readline'




export const loadTextLines = (path, manipulator, newline=false) => {
    return new Promise((res) => {
        const lineInterface = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
        let text = ''
        if (typeof manipulator !== 'function') {
            manipulator = (line) => line
        }
        lineInterface.on('line', (line) => {
            text += manipulator(line)
            if (newline === true) text += '\r\n'
        })
        lineInterface.on('close', () => res(text))
    })
}




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




export const sendTextFile = (path, type) => {
    return new Promise(async (res) => {
        let isJs = false
        if (type === 'javascript') {
            isJs = true
        }
        const text = await loadTextLines(path, (line) => line.trim(), true)
        if (text === undefined) {
            res(new Response(text, { 'Content-Type': 'text/' + type }, 500, 'loading text failed'))
        }
        else {
            res(sendFileData(text, 'text/' + type))
        }
    })
}




export const sendFile = (path, mimeType) => {
    loadFile(path)
    return new Promise((res) => {
        readFile(path, 'utf8', (err, data) => {
            // console.log(data.replaceAll('\r\n', '###\r\n'))
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




class Response {
    constructor(body='', headers={}, status=500, error=undefined) {
        this.body = body
        this.headers = headers
        this.status = status
        this.error = error
    }
}




export const easyHttpRequestHandler = (handlerConfigFunction) => {
    const routes = {}
    const events = {}

    const route = (path, callback, methods=[ 'GET' ]) => {
        for (const method of methods) {
            routes[`${method}:${path.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/<[^>]+>/g, '([^/]+)')}`] = {
                callback: async (parameters) => {
                    const response = await callback.apply(null, parameters)
                    if (response === null || response === undefined) {
                        runEvent('error', [ `invalid response: ${response}` ])
                        return { status: 500 }
                    }
                    if (response instanceof Response && response.error !== undefined) {
                        runEvent('error', [ response.error ])
                        return { status: 500 }
                    }
                    if (Number.isInteger(response)) return { status: response }
                    if (typeof response === 'string' || typeof response === 'number') return { body: response.toString(), status: 200 }
                    if (Array.isArray(response)) return { body: JSON.stringify(response), headers: { 'Content-Type': 'application/json' }, status: 200 }
                    if (response instanceof Response) return { body: response.body, headers: response.headers, status: response.status }
                    if (typeof response === 'object') return { body: JSON.stringify(response), headers: { 'Content-Type': 'application/json' },status: 200 }
                    runEvent('error', [ `invalid response: ${response}` ])
                    return { status: 500 }
                },
                pathElements: path.split('/')
            }
        }
    }

    const runEvent = (event, parameters=[]) => {
        if (typeof events[event] === 'function') {
            setTimeout(() => events[event].apply(null, parameters))
        }
    }

    const httpRequestEventHandler = {
        on: (event, callback) => {
            events[event] = callback
        }
    }

    handlerConfigFunction(route, httpRequestEventHandler)

    return async (request) => {
        request.time = Date.now()
        runEvent('request', [ request ])

        let response = { status: 404 }

        try {
            for (const [ route, { callback, pathElements } ] of Object.entries(routes)) {
                const [ method, path ] = route.split(':', 2)
                const regex = new RegExp(`^${path}$`)
                if (!regex.test(request.path) || method !== request.method) continue
                const elements = request.path.split('/')
                if (elements.length !== pathElements.length) break
                const parameters = [ request ]
                for (let i=0; i<elements.length; i++) {
                    if (pathElements[i].startsWith('<') && pathElements[i].endsWith('>')) parameters.push(elements[i])
                }
                response = await callback(parameters)
            }
        }
        catch(error) {
            if (error instanceof Object) {
                error = error.message
            }
            runEvent('error', [ error, request ])
            response.status = 500
        }

        runEvent('response', [ request, response ])
        return response
    }
}