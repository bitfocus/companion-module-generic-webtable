// index

import { InstanceBase, runEntrypoint, combineRgb } from '@companion-module/base'
import { randomBytes, createHash } from 'crypto'
import { upgradeScripts } from './upgrades.js'
import { httpReceiver, sendFile } from './companionModuleHttpReceiver.js'




class WebTableInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

        this.config = {}
        this.moduleInitiated = false
        this.files = {}

        this.tokens = {
            request: {},
            session: {}
        }
        this.valuesOptions = []

        this.httpReceiver = new httpReceiver()

        // index.html
        this.httpReceiver.route('/', () => sendFile('webserver-templates-index.html', 'text/html'))

        // scripts handler
        this.httpReceiver.route('/scripts/<name>', (request, name) => sendFile('webserver-scripts-' + name, 'text/javascript'))

        // api handler "GET"
        this.httpReceiver.route('/api/<cmd>', (request, cmd) => {
            switch(cmd) {
                case 'get_token':
                    if (request.query['type'] === null || !Object.keys(this.tokens).includes(request.query['type'])) return 400
                    let token = this.createToken()
                    while(this.tokenExists(token)) token = this.createToken()
                    this.tokens[request.query['type']][token] = 'Basic ' + this.createHash(token)
                    return { token: token, password: (this.config.password !== undefined && this.config.password !== '') }
                
                case 'get_size':
                    return { columns: this.config.columns, rows: this.config.rows }

                case 'get_current_data':
                    const status = this.proofAuthorization(request.query['token'], request.headers.authorization)
                    if (status !== 200) return status
                    return this.config.data
            }
        })

        // api handler "POST"
        this.httpReceiver.route('/api/<cmd>', (request, cmd) => {
            switch (cmd) {
                case 'submit_data':
                    const status = this.proofAuthorization(request.query['token'], request.headers.authorization)
                    if (status !== 200) return status
                    setTimeout(() => this.changeData(request.body))
                    return 200
            }
        }, [ 'POST' ])

        this.httpReceiver.log = (...args) => this.log(...args)
    }

    handleHttpRequest(request) {
        return this.httpReceiver.requestHandler(request)
    }

	// run "configUpdated()" when module gets enabled
	init = async (config) => this.configUpdated(config)

    async destroy() {
        this.saveConfig(this.config)
        this.moduleInitiated = false
        this.updateStatus('disconnected')
        this.log('info', 'Instance inactive!')
    }

	// update config and init module
	async configUpdated(config) {
        if (config.data === undefined) config.data = []
        if (config.status === undefined) config.status = {}
        this.config = config
        this.initModule()
	}

    async initModule() {
        if (this.config.rows <= 0) this.config.rows = 1
        if (this.config.columns <= 0) this.config.columns = 1
        if (this.config.status.external_access === undefined) this.config.status.external_access = true
        if (this.config.status.selected_row === undefined) this.config.status.selected_row = 0
        if (this.config.status.selected_row > this.config.data.length) this.config.status.selected_row = this.config.data.length

        this.changeData(this.getDataArray())

        this.checkFeedbacks()
        this.setVariableValues({ external_access_status: (this.config.status.external_access === false) ? 'block' : 'allow' })

        if (this.moduleInitiated === true) return

        this.moduleInitiated = true
		this.updateStatus('ok')
        this.log('info', 'Instance ready to use!')
    }

    getDataArray() {
        const data = []

        for (let r=0; r<this.config.rows; r++) {
            const row = []
            for (let c=0; c<this.config.columns; c++) row.push((this.config.data.length > r && this.config.data[r].length > c) ? this.config.data[r][c] : '')
            data.push(row)
        }

        return data
    }

    changeData(data, init=false) {
        if (this.config.status.external_access === false && init === false) return false
        if (!Array.isArray(data) || data.length === 0) return false

        const variableValues = {}
        
        for (let r=0; r<data.length; r++) {
            if (!Array.isArray(data[r]) || data[r].length === 0) return false
            if (this.config.cellVariables === true) for (let c=0; c<data[r].length; c++) {
                variableValues['value_' + this.getColumnLabel(c) + (r+1)] = data[r][c]
            }
        }
        
        this.config.data = data
        this.config.rows = data.length
        this.config.columns = data[0].length
        
        this.setActionDefinitions(this.getActions())
        this.setFeedbackDefinitions(this.getFeedbacks())
        this.setVariableDefinitions(this.getVariables())
        this.checkFeedbacks()
        this.setVariableValues(variableValues)

        this.saveConfig(this.config)

        if (this.config.status.selected_row > this.config.data.length) this.selectRow(this.config.data.length)
        else if (this.config.status.selected_row <= 0) this.selectRow(1)
        else this.selectRow(this.config.status.selected_row)
        this.log('info', `Table Size: ${this.config.data.length}x${this.config.columns}`)
    }

    changeValues(elements=[]) {
        if (!Array.isArray(elements) || elements.length === 0 || !Array.isArray(this.config.data) || this.config.data.length === 0) return false

        const variableValues = {}

        for (const element of elements) {
            if (!Array.isArray(element) || element.length < 3 || element[0] >= this.config.data.length
            || !Array.isArray(this.config.data[element[0]]) || element[1] >= this.config.data[element[0]].length) continue
            this.config.data[element[0]][element[1]] = element[2]
            variableValues['value_' + this.getColumnLabel(element[1]) + (element[0]+1)] = element[2]
        }

        if (Object.keys(variableValues).length === 0) return false

        this.checkFeedbacks('cell_value', 'row_values')
        this.setVariableValues(variableValues)
        this.saveConfig(this.config)
        return true
    }

    selectRow(id) {
        if (id <= 0 || id > this.config.data.length) return false

        this.config.status.selected_row = id

        const variableValues = {
            data_columns: this.config.columns,
            data_rows: this.config.data.length,
            selected_row_id: id
        }

        const labels = this.rowLabels()
        for (let i=0; i<this.config.columns; i++) variableValues['selected_row_value_' + labels[i]] = this.config.data[id-1][i]
        this.checkFeedbacks('selected_row', 'row_values')
        this.setVariableValues(variableValues)
    }

    getColumnLabel(index, upperCase=false) {
        let label = ''
        while (index >= 0) {
            label = String.fromCharCode((index % 26) + 97) + label
            index = Math.floor(index / 26) - 1;
        }
        if (label === '') return undefined
        if (upperCase === true) return label.toUpperCase()
        return label
    }

    getColumnIndex(label) {
        if (label === '') return undefined
        let index = 0
        for (let i=0; i<label.length; i++) {
            const charCode = label.charCodeAt(i)
            if (charCode >= 65 &&  charCode <= 90) index = i*26 + (charCode-65)
            else if (charCode >= 97 && charCode <= 122) index = i*26 + (charCode-97)
            else return undefined
        }
        return index
    }

    rowLabels() {
        if (this.config.columns === 0) return undefined
        const labels = []
        for (let i=0; i<this.config.columns; i++) {
            let label = this.getColumnLabel(i)
            if (label === undefined) return undefined
            labels.push(label)
        }
        if (this.config.columns === labels.length) return labels
        return undefined
    }

    createToken(length=32) {
        return randomBytes(length).toString('hex')
    }

    tokenExists(token) {
        for (const [ type, tokens ] of Object.entries(this.tokens)) {
            if (Object.keys(tokens).includes(token)) return true
        }
        return false
    }

    createHash(token) {
        return createHash('sha256').update(token + this.config.password).digest('hex')
    }

    proofAuthorization(token, clientAuth, type='request') {
        if (token === null || this.tokens[type] === undefined || this.tokens[type][token] === undefined) return 400
        const serverAuth = this.tokens[type][token]
        delete this.tokens[type][token]
        if (clientAuth === undefined || clientAuth !== serverAuth) return 401
        return 200
    }

    async logActionResult(id, context, message, error=false) {
        const time = new Date()
        const button = await context.parseVariablesInString('$(this:page)/$(this:row)/$(this:column)')
        if (button === '$NA/$NA/$NA') {
            if (error === true) this.log('error', `[${time.toLocaleTimeString()}]: Action "${id}" failed on trigger! ${message}`)
            else this.log('debug', `[${time.toLocaleTimeString()}]: Action "${id}" executed on trigger! ${message}`)
        }
        else {
            if (error === true) this.log('error', `[${time.toLocaleTimeString()}]: Action "${id}" failed on button "${button}"! ${message}`)
            else this.log('debug', `[${time.toLocaleTimeString()}]: Action "${id}" executed on button "${button}"! ${message}`)
        }
    }

    getConfigFields() {
        return [
            {
                type: 'static-text',
                id: 'info',
                width: 12,
                label: 'Information',
                value: 'This module will host a table, accessible from any webbrowser',
            },
			{
				type: 'textinput',
				id: 'password',
				label: 'Password:',
				width: 6,
				default: 'secret',
				tooltip: 'Enter a password to prevent unauthorized changes',
			},
            {
                type: 'number',
                id: 'columns',
                label: 'Columns:',
				width: 3,
                default: 2,
                min: 1,
                step: 1,
            },
            {
                type: 'number',
                id: 'rows',
                label: 'Rows:',
				width: 3,
                default: 5,
                min: 1,
                step: 1,
            },
            {
                type: 'static-text',
                id: 'test',
                width: 12,
                label: '',
                value: `<a href="/instance/${this.label}" target="_blank">🔗 Open table in new tab</a>`,
            },
            {
                type: 'checkbox',
                id: 'cellVariables',
                width: 8,
                label: 'Enable variables for all table cells:',
                default: false,
                tooltip: 'This can impact performance on lange tables!',
            }
        ]
    }

    getActions() {
        const rowChoices = []
        const columnOptions = []
        this.valuesOptions = []
        const labels = this.rowLabels()
        if (Array.isArray(this.config.data) && this.config.data.length > 0 && labels !== undefined) {
            rowChoices.push({ id: 'row_sel', label: 'Selected Row' })
            rowChoices.push({ id: 'row_var', label: 'Get From Variable' })
            rowChoices.push({ id: 'row_las', label: 'Last Row' })
            this.valuesOptions.push({
                type: 'dropdown',
                label: 'Select Row',
                id: 'row',
                default: (rowChoices.length > 0) ? rowChoices[0].id : undefined,
                choices: rowChoices,
            })
            this.valuesOptions.push({
                type: 'textinput',
                label: 'Variable For Row Selection',
                id: 'row_var',
                useVariables: true,
                default: '',
                tooltip: 'Enter a variable to select a specific row',
                isVisible: (options) => options.row === 'row_var'
            })
            this.valuesOptions.push({
                type: 'multidropdown',
                id: 'columns',
                label: 'Select Columns',
                default: [],
                choices: [],
            })
            for (let i=1; i<= this.config.data.length; i++) rowChoices.push({ id: i, label: 'Row ' + i })
        }
        if (labels !== undefined && this.config.columns > 0) {
            for (let i=0; i<labels.length; i++) {
                const label = labels[i].toUpperCase()
                const option = {
                    type: 'textinput',
                    label: `Content ${label}`,
                    id: i,
                    useVariables: true,
                    default: '',
                    isVisibleData: i,
                    isVisible: (options, column) => options.action === 'append' || (options.action === undefined && options.columns === undefined) || (Array.isArray(options.columns) && options.columns.includes(column))
                }
                columnOptions.push(option)
                if (this.valuesOptions.length < 3) continue
                this.valuesOptions[2].choices.push({ id: i, label: 'Column ' + label })
                this.valuesOptions.push(option)
            }
        }

        return {
            change_data_columns: {
                name: 'Change Data Columns',
                description: 'Change number of data columns',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Change Action',
                        id: 'action',
                        default: 'number',
                        choices: [
                            { id: 'number', label: 'Set From Number' },
                            { id: 'variable', label: 'Set From Variable' },
                            { id: 'remove', label: 'Remove Last Column' },
                            { id: 'append', label: 'Append New Column' },
                        ],
                    },
                    {
                        type: 'number',
                        label: 'Set Columns From Number',
                        id: 'columns',
                        default: 1,
                        min: 1,
                        step: 1,
                        isVisible: (options) => options.action === 'number'
                    },
                    {
                        type: 'textinput',
                        label: 'Set Columns From Variable',
                        id: 'variable',
                        useVariables: true,
                        default: '',
                        isVisible: (options) => options.action === 'variable'
                    },
                ],
                callback: async ({ options }, context) => {
                    switch(options.action) {
                        case 'variable':
                            options.columns = Number(await context.parseVariablesInString(options.variable))
                            break
                        case 'remove':
                            options.columns = this.config.columns - 1
                            break
                        case 'append':
                            options.columns = this.config.columns + 1
                            break
                    }
                    if (!Number.isInteger(options.columns) || options.columns <= 0) return
                    this.config.columns = options.columns
                    if (this.config.data.length === 0) {
                        this.setActionDefinitions(this.getActions())
                        this.setFeedbackDefinitions(this.getFeedbacks())
                        this.checkFeedbacks()
                        this.setVariableDefinitions({ data_columns: options.columns })
                        this.saveConfig(this.config)
                        return
                    }
                    const newData = []
                    for (const row of this.config.data) {
                        const rowLength = row.length
                        const newRow = []
                        for (let i=0; i<options.columns; i++) {
                            if (i < rowLength) newRow.push(row[i])
                            else newRow.push('')
                        }
                        newData.push(newRow)
                    }
                    this.changeData(newData)
                }
            },
            change_data_rows: {
                name: 'Change Data Rows',
                description: 'Change number of data rows',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Change Action',
                        id: 'action',
                        default: 'number',
                        choices: [
                            { id: 'number', label: 'Set From Number' },
                            { id: 'variable', label: 'Set From Variable' },
                            { id: 'remove', label: 'Remove Last Row' },
                            { id: 'append', label: 'Append New Row' },
                        ],
                    },
                    {
                        type: 'number',
                        label: 'Set Rows From Number',
                        id: 'rows',
                        default: 1,
                        min: 1,
                        step: 1,
                        isVisible: (options) => options.action === 'number'
                    },
                    {
                        type: 'textinput',
                        label: 'Set Columns From Variable',
                        id: 'variable',
                        useVariables: true,
                        default: '',
                        isVisible: (options) => options.action === 'variable'
                    },
                ].concat(columnOptions),
                callback: async ({ options }, context) => {
                    switch(options.action) {
                        case 'variable':
                            options.rows = Number(await context.parseVariablesInString(options.variable))
                            break
                        case 'remove':
                            options.rows = this.config.rows - 1
                            break
                        case 'append':
                            options.rows = this.config.rows + 1
                            const row = []
                            for (const value of Object.values(options).slice(0, -3)) row.push(await context.parseVariablesInString(value))
                            this.config.data.push(row)
                            break
                    }
                    if (!Number.isInteger(options.rows) || options.rows <= 0) return
                    this.config.rows = options.rows
                    this.changeData(this.getDataArray())
                }
            },
            clear_data: {
                name: 'Clear Data',
                description: 'Clear table data to reset all values',
                options: [],
                callback: () => {
                    this.config.data = []
                    this.config.status.selected_row = 0
                    this.config.rows = 0
                    this.config.columns = 0
                    this.setActionDefinitions(this.getActions())
                    this.setFeedbackDefinitions(this.getFeedbacks())
                    this.setVariableDefinitions(this.getVariables())
                    this.checkFeedbacks()
                    this.setVariableValues({
                        data_columns: this.config.columns,
                        data_rows: this.config.data.length,
                        selected_row_id: this.config.status.selected_row
                    })
                    this.saveConfig(this.config)
                }
            },
            control_external_access: {
                name: 'Control External Access',
                description: 'Control wether external users can submit new data or not',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Status',
                        id: 'status',
                        default: true,
                        choices: [
                            { id: true, label: 'Allow External Access' },
                            { id: false, label: 'Block External Access' },
                            { id: 'toggle', label: 'Toggle External Access' },
                        ],
                    }
                ],
                callback: ({ options }) => {
                    if (options.status === 'toggle') options.status = (this.config.status.external_access === false) ? true : false
                    this.config.status.external_access = options.status
                    this.checkFeedbacks('external_access_status')
                    this.setVariableValues({ external_access_status: (options.status === false) ? 'block' : 'allow' })
                }
            },
            select_row: {
                name: 'Select Row',
                description: 'Select a row by number, variable or select previous, next or last row',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Input Type',
                        id: 'type',
                        default: 'row_id',
                        choices: [
                            { id: 'row_id', label: 'Number' },
                            { id: 'row_var', label: 'Variable' },
                            { id: 'row_prev', label: 'Previous Row' },
                            { id: 'row_next', label: 'Next Row' },
                            { id: 'row_last', label: 'Last Row' },
                        ],
                    },
                    {
                        type: 'number',
                        label: 'Select Row From Number',
                        id: 'row_id',
                        useVariables: true,
                        default: 1,
                        min: 1,
                        max: this.config.data.length,
                        step: 1,
                        range: true,
                        tooltip: 'Enter a number to select a specific row',
                        isVisible: (options) => options.type === 'row_id'
                    },
                    {
                        type: 'textinput',
                        label: 'Select Row From Variable',
                        id: 'row_var',
                        useVariables: true,
                        default: '',
                        tooltip: 'Enter a variable to select a specific row',
                        isVisible: (options) => options.type === 'row_var'
                    },
                ],
                callback: async ({ options }, context) => {
                    switch(options.type) {
                        case 'row_var':
                            options.row_id = Number(await context.parseVariablesInString(options.row_var))
                            break
                        case 'row_prev':
                            options.row_id = this.config.status.selected_row - 1
                            break
                        case 'row_next':
                            options.row_id = this.config.status.selected_row + 1
                            break
                        case 'row_last':
                            options.row_id = this.config.data.length
                            break
                    }
                    if (!Number.isInteger(options.row_id)) return
                    this.selectRow(options.row_id)
                }
            },
            set_cell_value: {
                name: 'Set Cell Value',
                description: 'Set new value for specified cell',
                options: [
                    {
                        type: 'textinput',
                        label: 'Cell ID',
                        id: 'cell',
                        useVariables: true,
                        default: 'A1',
                        tooltip: 'e.g. A1, A2, B11, AC37...',
                    },
                    {
                        type: 'textinput',
                        label: 'Value',
                        id: 'value',
                        useVariables: true,
                        default: '',
                        tooltip: 'Enter any value to set the specified cell to',
                    }
                ],
                callback: async ({ actionId, options }, context) => {
                    if (this.config.data.length === 0) return this.logActionResult(actionId, context, 'No table data available', true)
                    if (options.cell === '') return this.logActionResult(actionId, context, 'Cell Id "<empty_string>" invalid', true)
                    options.cell = await context.parseVariablesInString(options.cell)
                    if (options.cell === '') return this.logActionResult(actionId, context, 'Cell Id "<empty_string>" invalid', true)
                    options.column = options.cell.replace(/[0-9]/g, '')
                    if (options.column === '') return this.logActionResult(actionId, context, `Cell Id "${options.cell}" invalid`, true)
                    options.row = parseInt(options.cell.replace(options.column, ''))
                    if (Number.isNaN(options.row)) return this.logActionResult(actionId, context, `Cell Id "${options.cell}" invalid`, true)
                    options.row--
                    if (options.row >= this.config.data.length || options.row < 0) return this.logActionResult(actionId, context, `Cell Id "${options.cell}" out of range`, true)
                    options.column = this.getColumnIndex(options.column)
                    if (options.column === undefined) return this.logActionResult(actionId, context, `Cell Id "${options.cell}" invalid`, true)
                    if (options.column >= this.config.data[0].length || options.column < 0) return this.logActionResult(actionId, context, `Cell Id "${options.cell}" out of range`, true)

                    if (this.changeValues([[options.row, options.column, options.value]])) this.logActionResult(actionId, context, `Cell "${options.cell}" set to value "${options.value}"`)
                    else this.logActionResult(actionId, context, `Cell "${options.cell}" set to value "${options.value}" failed`, true)
                }
            },
            set_row_values: {
                name: 'Set Row Values',
                description: 'Set new values for columns of any row',
                options: this.valuesOptions,
                callback: async ({ actionId , options }, context) => {
                    switch(options.row) {
                        case 'row_sel':
                            if (this.config.status.selected_row > 0) options.row = this.config.status.selected_row
                            break
                        case 'row_var':
                            options.row = Number(await context.parseVariablesInString(options.row_var))
                            break
                        case 'row_las':
                            if (this.config.data.length > 0) options.row = this.config.data.length
                            break
                    }

                    if (!Number.isInteger(options.row)) return this.logActionResult(actionId, context, `Row "${options.row}" invalid`, true)
                    if (options.row > this.config.data.length || options.row <= 0) return this.logActionResult(actionId, context, `Row "${options.row}" out of range`, true)
                    if (!Array.isArray(options.columns) || options.columns.length === 0) return this.logActionResult(actionId, context, `No columns selected`, true)

                    const elements = []
                    for (const column of options.columns) {
                        if (column >= this.config.data[options.row-1].length) continue
                        elements.push([ options.row-1, column, await context.parseVariablesInString(options[column]) ])
                    }

                    if (this.changeValues(elements)) this.logActionResult(actionId, context, `Row "${options.row}" set to new values`)
                    else return this.logActionResult(actionId, context, `Row "${options.row}" set to new values failed`, true)
                    
                    if (options.row === this.config.status.selected_row) this.selectRow(options.row)
                }
            }
        }
    }

    getFeedbacks() {
        return {
            cell_value: {
                type: 'boolean',
                name: 'Cell Value',
                description: 'Check the value of a cell',
                options: [
                    {
                        type: 'textinput',
                        label: 'Cell ID',
                        id: 'cell',
                        useVariables: true,
                        default: 'A1',
                    },
                    {
                        type: 'dropdown',
                        label: 'Operation',
                        id: 'operation',
                        default: 0,
                        choices: [
                            { id: 0, label: 'Matching' },
                            { id: 1, label: 'Including' },
                            { id: 2, label: 'Starting' },
                            { id: 3, label: 'Ending' },
                        ],
                    },
                    {
                        type: 'textinput',
                        label: 'Value',
                        id: 'value',
                        useVariables: true,
                        default: '',
                    },
                    {
                        type: 'checkbox',
                        label: 'Disable case sensitive comparison',
                        id: 'insesitive',
                    }
                ],
                defaultStyle: {
                    color: combineRgb(255, 255, 255),
                    bgcolor: combineRgb(0, 0, 255)
                },
                callback: async ({ feedbackId, options }, context) => {
                    if (this.config.data.length === 0 || options.cell === '') return false
                    options.cell = await context.parseVariablesInString(options.cell)
                    if (options.cell === '') return false
                    options.column = options.cell.replace(/[0-9]/g, '')
                    if (options.column === '') return false
                    options.row = parseInt(options.cell.replace(options.column, ''))
                    if (Number.isNaN(options.row)) return false
                    options.row--
                    if (options.row >= this.config.data.length || options.row < 0) return false
                    options.column = this.getColumnIndex(options.column)
                    if (options.column === undefined) return false
                    if (options.column >= this.config.data[0].length || options.column < 0) return false
                    
                    options.value = await context.parseVariablesInString(options.value)
                    options.reference = this.config.data[options.row][options.column]

                    if (options.insesitive === true) {
                        options.value = options.value.toLowerCase()
                        options.reference = options.reference.toLowerCase()
                    }

                    if (options.operation === 0 && options.reference === options.value) return true
                    if (options.reference !== '' && options.value === '') return false
                    if (options.operation === 1 && options.reference.includes(options.value)) return true
                    if (options.operation === 2 && options.reference.startsWith(options.value)) return true
                    if (options.operation === 3 && options.reference.endsWith(options.value)) return true

                    return false
                }
            },
            data_available: {
                type: 'boolean',
                name: 'Data Available',
                description: 'Check if any data is available to select',
                options: [],
                defaultStyle: {
                    color: combineRgb(255, 255, 255),
                    bgcolor: combineRgb(0, 0, 255)
                },
                callback: () => Array.isArray(this.config.data) && this.config.data.length > 0
            },
            external_access_status: {
                type: 'boolean',
                name: 'External Access Status',
                description: 'Check wether external users can submit new data or not',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Status',
                        id: 'status',
                        default: true,
                        choices: [
                            { id: true, label: 'External Access Allowed' },
                            { id: false, label: 'External Access Blocked' },
                        ],
                    }
                ],
                defaultStyle: {
                    color: combineRgb(255, 255, 255),
                    bgcolor: combineRgb(0, 0, 255)
                },
                callback: ({ options }) => options.status === this.config.status.external_access || (options.status === true && this.config.status.external_access === undefined)
            },
            row_values: {
                type: 'boolean',
                name: 'Row Values',
                description: 'Check values for columns of any row',
                options: this.valuesOptions,
                defaultStyle: {
                    color: combineRgb(255, 255, 255),
                    bgcolor: combineRgb(0, 0, 255)
                },
                callback: async ({ options }, context) => {
                    let row = 0
                    switch(options.row) {
                        case 'row_sel':
                            if (this.config.status.selected_row > 0) row = this.config.status.selected_row
                            break
                        case 'row_var':
                            row = Number(await context.parseVariablesInString(options.row_var))
                            break
                        case 'row_las':
                            if (this.config.data.length > 0) row = this.config.data.length
                            break
                        default:
                            row = options.row
                    }
                    
                    if (!Number.isInteger(row) || row === 0 || row > this.config.data.length || options.columns.length === 0) return false
                    
                    for (const column of options.columns) {
                        if (column >= this.config.data[row-1].length) continue
                        if (this.config.data[row-1][column] !== await context.parseVariablesInString(options[column])) return false
                    }
                    return true
                }
            },
            selected_row: {
                type: 'boolean',
                name: 'Selected Row',
                description: 'Check if a specified row is currently selected',
                options: [
                    {
                        type: 'dropdown',
                        label: 'Input Type',
                        id: 'type',
                        default: 'row_id',
                        choices: [
                            { id: 'row_id', label: 'Number' },
                            { id: 'row_var', label: 'Variable' },
                            { id: 'row_last', label: 'Last Row' },
                        ],
                    },
                    {
                        type: 'number',
                        label: 'Check Row From Number',
                        id: 'row_id',
                        default: 1,
                        min: 1,
                        max: this.config.data.length,
                        step: 1,
                        range: true,
                        tooltip: 'Enter a number to check a specific row',
                        isVisible: (options) => options.type === 'row_id'
                    },
                    {
                        type: 'textinput',
                        label: 'Check Row From Variable',
                        id: 'row_var',
                        useVariables: true,
                        default: '',
                        tooltip: 'Enter a variable to check a specific row',
                        isVisible: (options) => options.type === 'row_var'
                    },
                ],
                defaultStyle: {
                    color: combineRgb(255, 255, 255),
                    bgcolor: combineRgb(0, 0, 255)
                },
                callback: async ({ options }, context) => {
                    switch(options.type) {
                        case 'row_var':
                            options.row_id = Number(await context.parseVariablesInString(options.row_var))
                            break
                        case 'row_last':
                            options.row_id = this.config.data.length
                            break
                    }
                    if (Number.isInteger(options.row_id) && options.row_id === this.config.status.selected_row) return true
                    return false
                }
            }
        }
    }

    getVariables() {
        const variables = [
            { variableId: 'data_columns', name: 'Data Columns' },
            { variableId: 'data_rows', name: 'Data Rows' },
            { variableId: 'external_access_status', name: 'External Access Status' },
        ]

        if (this.config.data.length > 0) {
            const labels = this.rowLabels()
            if (labels !== undefined) for (const label of labels) {
                variables.push({ variableId: 'selected_row_value_' +  label, name: 'Selected Row Value ' + label.toUpperCase() })
            }

            if (this.config.cellVariables === true) {
                if (labels !== undefined) for (let r=0; r<this.config.data.length; r++) {
                    for (let c=0; c<labels.length; c++) {
                        const id = labels[c] + (r+1)
                        variables.push({ variableId: 'value_' + id, name: 'Individual Cell Value ' + id.toUpperCase()})
                    }
                }
            }
        }

        variables.push({ variableId: 'selected_row_id', name: 'Selected Row' })

        return variables
    }
}


runEntrypoint(WebTableInstance, upgradeScripts)