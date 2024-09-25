


// read text string from file
function readFile(types='*.*', timeout=60) {

    return new Promise((res) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = types
        input.addEventListener('change', async (event) => {
            if (event.target.files.length === 0) res(undefined)
            const type = event.target.files[0].name.split('.').slice(-1)[0]
            if (!types.includes(type.toLowerCase()) && !types.includes(type)) res(undefined)
            res(await fetch(window.URL.createObjectURL(event.target.files[0])))
        })
        input.click()
        setTimeout(() => {
            res(undefined)
            delete input
        }, timeout*1000)
    })
}



// parse CSV from file in JSON (nested arrays)
function parseCSV(file, timeout=60) {

    const parse = (csvString) => {
        if (typeof csvString !== 'string') return undefined

        const lines = []
        let currentLine = []
        let currentField = ''
        let insideQuotes = false
        let currentChar = ''

        for (let i = 0; i < csvString.length; i++) {
            currentChar = csvString[i]

            if (insideQuotes) {
                if (currentChar === '"') {
                    if (csvString[i + 1] === '"') {
                        currentField += '"'
                        i++
                    } else insideQuotes = false
                } else currentField += currentChar
            } else {
                if (currentChar === '"') insideQuotes = true
                else if (currentChar === ',') {
                    currentLine.push(currentField)
                    currentField = ''
                } else if (currentChar === '\n' || (currentChar === '\r' && csvString[i + 1] === '\n')) {
                    if (currentChar === '\r') i++
                    currentLine.push(currentField)
                    lines.push(currentLine)
                    currentLine = []
                    currentField = ''
                } else currentField += currentChar
            }
        }

        if (currentField || csvString[csvString.length - 1] === ',') currentLine.push(currentField)
        if (currentLine.length > 0) lines.push(currentLine)

        const numColumns = lines[0]?.length || 0
        for (let line of lines) {
            if (line.length !== numColumns) return undefined
        }

        return lines
    }

    return new Promise(async (res) => {
        setTimeout(() => res(undefined), timeout*1000)
        file.text().then((text) => res(parse(text))).then(() => res(undefined))
    })
}



// serialize JSON (nested arrays) to CSV
function serializeCSV(csvData, timeout=60) {

    const serialize = () => {
        if (!Array.isArray(csvData) || csvData.length === 0) return undefined
        let csvString = ''
        for (const line of csvData) {
            if (!Array.isArray(line) || line.length === 0) continue
            let lineString = ''
            for (const element of line) lineString += `"${element.replaceAll('"', '""')}",`
            csvString += lineString.slice(0, -1) + '\r\n'
        }
        return csvString
    }

    return new Promise((res) => {
        setTimeout(() => res(undefined), timeout*1000)
        res(serialize())
    })
}



// write data (text/plain by default) to file
function writeFile(data, filename, type='text/plain', timeout=60) {
    return new Promise((res) => {
        if (data === undefined) {
            res(false)
            return
        }
        setTimeout(() => res(false), timeout*1000)
        const link = document.createElement('a')
        const file = new Blob([data], { type: type })
        link.href = URL.createObjectURL(file)
        link.download = filename
        link.click()
        URL.revokeObjectURL(link.href)
        res(true)
    })
}